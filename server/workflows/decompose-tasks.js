const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const {
  CATEGORY_KEYS,
  SOURCE_TO_CATEGORY,
  normalizeDueForWrite,
  normalizeTask,
  parseEstimatedMinutes,
} = require('../contracts/time-management');
const { shanghaiBusinessDay } = require('../daily-tracking/business-date');
const { applyDeadlineUrgency } = require('../policies/deadline');
const { loadVersionedPrompt } = require('../prompts/load-versioned-prompt');
const { checkIntake, splitEntries } = require('./check-intake');
const { checkTaskSmart } = require('./check-task-smart');
const {
  DECOMPOSITION_ITEM_LIMIT,
  EVIDENCE_TASK_RESPONSE_SCHEMA,
  TASK_RESPONSE_V2_SCHEMA,
  validateEvidenceResponseV2,
  validateTaskResponseV2,
} = require('./decomposition-contracts');

const PIPELINE_VERSION = 'task-first-v2';
const SOURCE_FOR_DIMENSION = Object.freeze({
  昨天: '复盘',
  今天: '今天',
  明天: '短期目标',
  后天: '中长期',
});

function publicError(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function outputError(stage, failedRules = []) {
  return Object.assign(
    publicError('MODEL_OUTPUT_INVALID', 'AI 返回格式异常，请重试。', 502),
    { stage, failedRules },
  );
}

function normalizeModelError(error, stage) {
  if (error.code === 'MODEL_OUTPUT_INVALID') {
    return Object.assign(outputError(stage), {
      diagnosticCode: error.diagnosticCode,
    });
  }
  if (error.code === 'MODEL_TIMEOUT') {
    return publicError('MODEL_TIMEOUT', 'AI 响应超时，请重试。', 504);
  }
  if (error.code === 'MODEL_CANCELLED') {
    return publicError('REQUEST_CANCELLED', '请求已取消。', 499);
  }
  if ([
    'MODEL_UPSTREAM_ERROR',
    'MODEL_RESPONSE_ENVELOPE_TOO_LARGE',
    'MODEL_ERROR_BODY_TOO_LARGE',
  ].includes(error.code)) {
    return publicError('MODEL_UPSTREAM_ERROR', 'AI 服务暂时不可用，请稍后重试。', 502);
  }
  return error;
}

function linesForEntries(entries) {
  return Object.fromEntries(
    CATEGORY_KEYS.map(key => [key, splitEntries(entries[key])]),
  );
}

function assertEvidenceTrace(response, entries) {
  const lines = linesForEntries(entries);
  const ids = new Set();
  const coveredLines = new Set();

  for (const evidence of response.evidence) {
    if (ids.has(evidence.id)) {
      throw outputError('evidence-task-generation', ['EVIDENCE_ID_DUPLICATED']);
    }
    ids.add(evidence.id);
    const sourceLine = lines[evidence.dimension]?.[evidence.sourceLineIndex];
    if (!sourceLine) {
      throw outputError('evidence-task-generation', ['EVIDENCE_SOURCE_LINE_NOT_FOUND']);
    }
    if (!sourceLine.includes(evidence.quote)) {
      throw outputError('evidence-task-generation', ['EVIDENCE_QUOTE_NOT_IN_SOURCE_LINE']);
    }
    if (evidence.owner !== '待确认' && !sourceLine.includes(evidence.owner)) {
      throw outputError('evidence-task-generation', ['EVIDENCE_OWNER_NOT_IN_SOURCE_LINE']);
    }
    if (evidence.due !== '待确认' && !sourceLine.includes(evidence.due)) {
      throw outputError('evidence-task-generation', ['EVIDENCE_DUE_NOT_IN_SOURCE_LINE']);
    }
    coveredLines.add(`${evidence.dimension}:${evidence.sourceLineIndex}`);
  }

  for (const dimension of CATEGORY_KEYS) {
    for (const index of lines[dimension].keys()) {
      if (!coveredLines.has(`${dimension}:${index}`)) {
        throw outputError('evidence-task-generation', ['INPUT_LINE_NOT_COVERED']);
      }
    }
  }
}

function evidenceMap(response) {
  return new Map(response.evidence.map(item => [item.id, item]));
}

function assertTaskShapeAndSemantics(response, evidenceResponse) {
  const byEvidenceId = evidenceMap(evidenceResponse);
  const primaryCoverage = new Set();

  for (const task of response.tasks) {
    if (!task.evidenceIds.length) {
      throw outputError('evidence-task-generation', ['TASK_WITHOUT_EVIDENCE']);
    }
    if (new Set(task.evidenceIds).size !== task.evidenceIds.length) {
      throw outputError('evidence-task-generation', ['TASK_EVIDENCE_DUPLICATED']);
    }
    if (task.status !== 'pending') {
      throw outputError('evidence-task-generation', ['TASK_STATUS_NOT_PENDING']);
    }
    const referenced = task.evidenceIds.map(id => byEvidenceId.get(id));
    if (referenced.some(item => !item)) {
      throw outputError('evidence-task-generation', ['TASK_EVIDENCE_NOT_FOUND']);
    }
    if (referenced.some(item => ['completed', 'not_actionable'].includes(item.status))) {
      throw outputError('evidence-task-generation', ['NON_ACTIONABLE_EVIDENCE_USED']);
    }

    const primary = referenced[0];
    const expectedSource = SOURCE_FOR_DIMENSION[primary.dimension];
    const sourceMatches = primary.dimension === '今天'
      ? ['今天', '临时'].includes(task.source)
      : task.source === expectedSource;
    if (!sourceMatches) {
      throw outputError('evidence-task-generation', ['TASK_SOURCE_MISMATCH']);
    }
    if (task.source === '临时' && !/临时|突发|插入|插单/.test(primary.quote)) {
      throw outputError('evidence-task-generation', ['TEMPORARY_SOURCE_UNSUPPORTED']);
    }
    if (task.owner !== '待确认' && task.owner !== primary.owner) {
      throw outputError('evidence-task-generation', ['TASK_OWNER_NOT_GROUNDED']);
    }
    if (task.due !== '待确认' && task.due !== primary.due) {
      throw outputError('evidence-task-generation', ['TASK_DUE_NOT_GROUNDED']);
    }
    if (
      ['短期目标', '中长期'].includes(task.source)
      && task.acceptanceCriteria.length === 0
    ) {
      throw outputError('evidence-task-generation', ['FUTURE_TASK_WITHOUT_ACCEPTANCE']);
    }
    const estimatedMinutes = parseEstimatedMinutes(task.est);
    if (
      estimatedMinutes !== null
      && estimatedMinutes > 8 * 60
      && (task.source !== '中长期' || !task.nextAction.trim())
    ) {
      throw outputError('evidence-task-generation', ['OVERSIZED_TASK_NOT_DECOMPOSED']);
    }
    primaryCoverage.add(primary.id);
  }

  for (const evidence of evidenceResponse.evidence) {
    if (
      ['planned', 'unfinished'].includes(evidence.status)
      && !primaryCoverage.has(evidence.id)
    ) {
      throw outputError('evidence-task-generation', ['ACTIONABLE_EVIDENCE_NOT_COVERED']);
    }
  }
}

function validateEvidencePart(response, entries) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw outputError('evidence-task-generation', ['JSON_SCHEMA_INVALID']);
  }
  const evidenceResponse = { evidence: response.evidence };
  if (!validateEvidenceResponseV2(evidenceResponse)) {
    throw outputError('evidence-task-generation', ['EVIDENCE_SCHEMA_INVALID']);
  }
  assertEvidenceTrace(evidenceResponse, entries);
  return evidenceResponse;
}

function validateTaskPart(response, evidenceResponse) {
  const taskResponse = { tasks: response?.tasks };
  if (!validateTaskResponseV2(taskResponse)) {
    throw outputError('evidence-task-generation', ['TASK_SCHEMA_INVALID']);
  }
  assertTaskShapeAndSemantics(taskResponse, evidenceResponse);
  return taskResponse;
}

function validateJointResponse(response, entries) {
  const keys = response && typeof response === 'object'
    ? Object.keys(response).sort()
    : [];
  if (keys.length !== 2 || keys[0] !== 'evidence' || keys[1] !== 'tasks') {
    throw outputError('evidence-task-generation', ['JSON_SCHEMA_INVALID']);
  }
  const evidenceResponse = validateEvidencePart(response, entries);
  const taskResponse = validateTaskPart(response, evidenceResponse);
  return { evidenceResponse, taskResponse };
}

function canRetry(deadlineAt, monotonicNow) {
  return !Number.isFinite(deadlineAt) || deadlineAt - monotonicNow() >= 2_000;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

async function runEvidenceTaskStage({
  modelClient,
  entries,
  businessDate,
  signal,
  deadlineAt,
  responseFormatMode,
  maxTokens,
  onAttempt,
  monotonicNow,
}) {
  const taskPrompt = loadVersionedPrompt('decomposition.evidence-task-generation');
  const correctionPrompt = loadVersionedPrompt('decomposition.task-generation');
  const attemptEvents = [];
  let modelCalls = 0;
  const startedAt = monotonicNow();

  const recordAttempt = event => {
    attemptEvents.push(event);
    try {
      onAttempt?.({ ...event, stage: 'evidence-task-generation' });
    } catch {
      // Logging must not affect generation.
    }
  };

  async function invoke({ prompt, input, schema, schemaName }) {
    modelCalls += 1;
    try {
      return await modelClient.completeJson({
        system: prompt.text,
        user: JSON.stringify(input),
        temperature: 0.1,
        maxAttempts: 1,
        responseSchema: schema,
        responseSchemaName: schemaName,
        signal,
        deadlineAt,
        responseFormatMode,
        maxTokens,
        maxContentBytes: 64 * 1024,
        onAttempt: recordAttempt,
      });
    } catch (error) {
      throw normalizeModelError(error, 'evidence-task-generation');
    }
  }

  const baseInput = { goals: entries, businessDate };
  let firstResponse;
  try {
    firstResponse = await invoke({
      prompt: taskPrompt,
      input: baseInput,
      schema: EVIDENCE_TASK_RESPONSE_SCHEMA,
      schemaName: 'time_evidence_task_generation_v2',
    });
  } catch (error) {
    if (error.code !== 'MODEL_OUTPUT_INVALID' || !canRetry(deadlineAt, monotonicNow)) {
      throw error;
    }
    const corrected = await invoke({
      prompt: taskPrompt,
      input: {
        ...baseInput,
        retryFeedback: {
          failedRules: [error.diagnosticCode || 'MODEL_JSON_INVALID'],
          correction: '重新生成完整 evidence 与 tasks JSON。',
        },
      },
      schema: EVIDENCE_TASK_RESPONSE_SCHEMA,
      schemaName: 'time_evidence_task_generation_v2',
    });
    validateJointResponse(corrected, entries);
    firstResponse = corrected;
  }

  let evidenceResponse;
  try {
    evidenceResponse = validateEvidencePart(firstResponse, entries);
  } catch (error) {
    if (error.code !== 'MODEL_OUTPUT_INVALID' || !canRetry(deadlineAt, monotonicNow)) {
      throw error;
    }
    const corrected = await invoke({
      prompt: taskPrompt,
      input: {
        ...baseInput,
        retryFeedback: {
          failedRules: error.failedRules,
          correction: '重新生成完整 evidence 与 tasks，逐行修正证据。',
        },
      },
      schema: EVIDENCE_TASK_RESPONSE_SCHEMA,
      schemaName: 'time_evidence_task_generation_v2',
    });
    validateJointResponse(corrected, entries);
    firstResponse = corrected;
    evidenceResponse = { evidence: corrected.evidence };
  }

  let taskResponse;
  try {
    taskResponse = validateTaskPart(firstResponse, evidenceResponse);
  } catch (error) {
    if (error.code !== 'MODEL_OUTPUT_INVALID' || !canRetry(deadlineAt, monotonicNow)) {
      throw error;
    }
    const frozenEvidence = copy(evidenceResponse.evidence);
    const corrected = await invoke({
      prompt: correctionPrompt,
      input: {
        ...baseInput,
        evidence: frozenEvidence,
        retryFeedback: {
          failedRules: error.failedRules,
          correction: '只返回 tasks，禁止返回或修改 evidence。',
        },
      },
      schema: TASK_RESPONSE_V2_SCHEMA,
      schemaName: 'time_task_generation_v2',
    });
    taskResponse = validateTaskPart(corrected, { evidence: frozenEvidence });
    evidenceResponse = { evidence: frozenEvidence };
  }

  const successfulAttempt = [...attemptEvents]
    .reverse()
    .find(event => !event.errorCode);
  return {
    prompt: taskPrompt,
    response: {
      evidence: evidenceResponse.evidence,
      tasks: taskResponse.tasks,
    },
    attempts: Math.max(modelCalls, attemptEvents.length),
    durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
    responseFormat: successfulAttempt?.responseFormat
      || (responseFormatMode === 'json_object' ? 'json_object' : 'json_schema'),
    fallbackUsed: attemptEvents.some(event => event.fallbackUsed),
  };
}

function normalizeGeneratedTasks(taskResponse, evidenceResponse, goals, now) {
  const instant = now();
  const deadlineContext = {
    now: () => instant,
    timeZone: 'Asia/Shanghai',
  };
  return taskResponse.tasks.map(candidate => {
    const task = normalizeTask({
      ...candidate,
      classificationSource: 'ai-extraction',
    });
    const normalized = normalizeDueForWrite(applyDeadlineUrgency(task, {
      ...deadlineContext,
      goalText: goals[SOURCE_TO_CATEGORY[task.source]] || '',
    }));
    return {
      task: normalized,
      evidenceIds: [...candidate.evidenceIds],
    };
  });
}

async function decomposeTasks({
  entries,
  modelClient,
  requestBody,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
  signal,
  deadlineAt,
  responseFormatMode,
  maxTokens,
  onAttempt,
  decompositionId = randomUUID(),
} = {}) {
  const input = requestBody || { entries };
  const intake = checkIntake({ requestBody: input });
  if (intake.totalLines > DECOMPOSITION_ITEM_LIMIT) {
    throw publicError(
      'DECOMPOSITION_ITEM_LIMIT_EXCEEDED',
      `快速拆解单次最多处理 ${DECOMPOSITION_ITEM_LIMIT} 项事务。`,
      422,
    );
  }

  const instant = now();
  const businessDate = shanghaiBusinessDay(instant).trackingDate;
  const stage = await runEvidenceTaskStage({
    modelClient,
    entries: intake.entries,
    businessDate,
    signal,
    deadlineAt,
    responseFormatMode,
    maxTokens,
    onAttempt,
    monotonicNow,
  });
  const taskResponse = { tasks: stage.response.tasks };
  const evidenceResponse = { evidence: stage.response.evidence };
  const normalized = normalizeGeneratedTasks(
    taskResponse,
    evidenceResponse,
    intake.entries,
    () => instant,
  );
  if (normalized.length === 0) {
    throw publicError(
      'NO_ACTIONABLE_TASKS',
      '没有识别出可执行任务，请调整四栏内容后重试。',
      422,
    );
  }

  const tasks = normalized.map(item => item.task);
  const smart = checkTaskSmart({ tasks });
  return {
    intake: {
      lineCounts: intake.lineCounts,
      totalLines: intake.totalLines,
      warnings: intake.warnings,
    },
    tasks,
    smart,
    decomposition: {
      pipelineVersion: PIPELINE_VERSION,
      decompositionId,
      businessDate,
      stages: [{
        name: 'evidence-task-generation',
        status: 'succeeded',
        prompt: {
          id: stage.prompt.id,
          version: stage.prompt.version,
          sha256: stage.prompt.sha256,
        },
        attempts: stage.attempts,
        durationMs: stage.durationMs,
        responseFormat: stage.responseFormat,
        fallbackUsed: stage.fallbackUsed,
        output: stage.response,
      }],
      taskEvidence: normalized.map(item => ({
        taskId: item.task.id,
        evidenceIds: item.evidenceIds,
      })),
    },
  };
}

module.exports = {
  assertEvidenceTrace,
  assertTaskShapeAndSemantics,
  decomposeTasks,
};
