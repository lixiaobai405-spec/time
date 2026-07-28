const {
  SOURCE_TO_CATEGORY,
  TASK_LIMIT,
  normalizeDueForWrite,
  normalizeTask,
  parseEstimatedMinutes,
} = require('../contracts/time-management');
const { shanghaiBusinessDay } = require('../daily-tracking/business-date');
const { applyDeadlineUrgency } = require('../policies/deadline');
const { loadVersionedPrompt } = require('../prompts/load-versioned-prompt');
const { checkIntake } = require('./check-intake');
const { checkTaskSmart } = require('./check-task-smart');
const {
  COACH_RESPONSE_SCHEMA,
  TASK_RESPONSE_SCHEMA,
  validateCoachResponse,
  validateTaskResponse,
  visitClaims,
} = require('./decomposition-contracts');

const PIPELINE_VERSION = 'coach-decompose-v1';
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
  if (error.code === 'MODEL_OUTPUT_INVALID') return outputError(stage);
  if (error.code === 'MODEL_TIMEOUT') {
    return publicError('MODEL_TIMEOUT', 'AI 响应超时，请重试。', 504);
  }
  if (error.code === 'MODEL_UPSTREAM_ERROR') {
    return publicError('MODEL_UPSTREAM_ERROR', 'AI 服务暂时不可用，请稍后重试。', 502);
  }
  return error;
}

function assertEvidenceTrace(response, goals) {
  const ids = new Set();
  for (const evidence of response.evidence) {
    if (ids.has(evidence.id)) throw outputError('coach-analysis', ['EVIDENCE_ID_DUPLICATED']);
    ids.add(evidence.id);
    const sourceText = goals[evidence.dimension] || '';
    if (!sourceText.includes(evidence.quote)) {
      throw outputError('coach-analysis', ['EVIDENCE_QUOTE_NOT_IN_SOURCE']);
    }
    if (evidence.owner !== '待确认' && !sourceText.includes(evidence.owner)) {
      throw outputError('coach-analysis', ['EVIDENCE_OWNER_NOT_IN_SOURCE']);
    }
    if (evidence.due !== '待确认' && !sourceText.includes(evidence.due)) {
      throw outputError('coach-analysis', ['EVIDENCE_DUE_NOT_IN_SOURCE']);
    }
  }

  visitClaims(response.coachingAnalysis, (claim) => {
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) {
      throw outputError('coach-analysis', ['CLAIM_EVIDENCE_DUPLICATED']);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!ids.has(evidenceId)) {
        throw outputError('coach-analysis', ['CLAIM_EVIDENCE_NOT_FOUND']);
      }
    }
    if (claim.evidenceIds.length === 0 && !claim.text.startsWith('证据不足')) {
      throw outputError('coach-analysis', ['UNSUPPORTED_CLAIM_NOT_MARKED']);
    }
  });
}

function evidenceMap(response) {
  return new Map(response.evidence.map(item => [item.id, item]));
}

function assertTaskShapeAndSemantics(response, coachResponse) {
  const byEvidenceId = evidenceMap(coachResponse);
  const primaryCoverage = new Map();

  for (const task of response.tasks) {
    if (!task.evidenceIds.length) {
      throw outputError('task-generation', ['TASK_WITHOUT_EVIDENCE']);
    }
    if (new Set(task.evidenceIds).size !== task.evidenceIds.length) {
      throw outputError('task-generation', ['TASK_EVIDENCE_DUPLICATED']);
    }
    if (task.status !== 'pending') {
      throw outputError('task-generation', ['TASK_STATUS_NOT_PENDING']);
    }
    const referenced = task.evidenceIds.map(id => byEvidenceId.get(id));
    if (referenced.some(item => !item)) {
      throw outputError('task-generation', ['TASK_EVIDENCE_NOT_FOUND']);
    }
    const primary = referenced[0];
    const expectedSource = SOURCE_FOR_DIMENSION[primary.dimension];
    const sourceMatches = primary.dimension === '今天'
      ? ['今天', '临时'].includes(task.source)
      : task.source === expectedSource;
    if (!sourceMatches) {
      throw outputError('task-generation', ['TASK_SOURCE_MISMATCH']);
    }
    if (
      task.source === '临时'
      && !/临时|突发|插入|插单/.test(primary.quote)
    ) {
      throw outputError('task-generation', ['TEMPORARY_SOURCE_UNSUPPORTED']);
    }
    if (['completed', 'not_actionable'].includes(primary.status)) {
      throw outputError('task-generation', ['NON_ACTIONABLE_EVIDENCE_USED']);
    }
    if (task.owner !== '待确认' && task.owner !== primary.owner) {
      throw outputError('task-generation', ['TASK_OWNER_NOT_GROUNDED']);
    }
    if (task.due !== '待确认' && task.due !== primary.due) {
      throw outputError('task-generation', ['TASK_DUE_NOT_GROUNDED']);
    }
    if (
      ['短期目标', '中长期'].includes(task.source)
      && task.acceptanceCriteria.length === 0
    ) {
      throw outputError('task-generation', ['FUTURE_TASK_WITHOUT_ACCEPTANCE']);
    }
    const estimatedMinutes = parseEstimatedMinutes(task.est);
    if (
      estimatedMinutes !== null
      && estimatedMinutes > 8 * 60
      && (task.source !== '中长期' || !task.nextAction.trim())
    ) {
      throw outputError('task-generation', ['OVERSIZED_TASK_NOT_DECOMPOSED']);
    }
    primaryCoverage.set(primary.id, (primaryCoverage.get(primary.id) || 0) + 1);
  }

  for (const evidence of coachResponse.evidence) {
    if (
      evidence.dimension === '昨天'
      && evidence.status === 'unfinished'
      && !primaryCoverage.has(evidence.id)
    ) {
      throw outputError('task-generation', ['UNFINISHED_YESTERDAY_NOT_COVERED']);
    }
    if (
      evidence.dimension === '昨天'
      && evidence.status === 'completed'
      && primaryCoverage.has(evidence.id)
    ) {
      throw outputError('task-generation', ['COMPLETED_YESTERDAY_BECAME_TASK']);
    }
  }
}

async function runValidatedStage({
  modelClient,
  prompt,
  input,
  responseSchema,
  responseSchemaName,
  validateShape,
  validateSemantics,
  stage,
}) {
  let retryFeedback = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response;
    try {
      response = await modelClient.completeJson({
        system: prompt.text,
        user: JSON.stringify(retryFeedback ? { ...input, retryFeedback } : input),
        temperature: 0.1,
        maxAttempts: 1,
        responseSchema,
        responseSchemaName,
      });
    } catch (error) {
      const normalized = normalizeModelError(error, stage);
      if (normalized.code !== 'MODEL_OUTPUT_INVALID' || attempt === 2) throw normalized;
      retryFeedback = {
        failedRules: normalized.failedRules || ['MODEL_JSON_INVALID'],
        correction: '重新生成完整 JSON，并严格满足响应 Schema 与证据约束。',
      };
      continue;
    }

    try {
      if (!validateShape(response)) {
        throw outputError(stage, ['JSON_SCHEMA_INVALID']);
      }
      validateSemantics(response);
      return response;
    } catch (error) {
      if (attempt === 2 || error.code !== 'MODEL_OUTPUT_INVALID') throw error;
      retryFeedback = {
        failedRules: error.failedRules || ['SEMANTIC_VALIDATION_FAILED'],
        correction: '仅修正失败规则，重新返回完整 JSON，不得省略字段。',
      };
    }
  }
  throw outputError(stage);
}

function normalizeGeneratedTasks(taskResponse, coachResponse, goals, now) {
  const instant = now();
  const deadlineContext = {
    now: () => instant,
    timeZone: 'Asia/Shanghai',
  };
  return taskResponse.tasks.map((candidate) => {
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

async function decomposeTasks({ entries, modelClient, requestBody, now = () => new Date() } = {}) {
  const input = requestBody || { entries };
  const intake = checkIntake({ requestBody: input });
  const instant = now();
  const businessDate = shanghaiBusinessDay(instant).trackingDate;
  const coachPrompt = loadVersionedPrompt('decomposition.coach-analysis');
  const coachResponse = await runValidatedStage({
    modelClient,
    prompt: coachPrompt,
    input: { goals: intake.entries, businessDate },
    responseSchema: COACH_RESPONSE_SCHEMA,
    responseSchemaName: 'time_coach_analysis_v1',
    validateShape: validateCoachResponse,
    validateSemantics: response => assertEvidenceTrace(response, intake.entries),
    stage: 'coach-analysis',
  });

  const taskPrompt = loadVersionedPrompt('decomposition.task-generation');
  const taskResponse = await runValidatedStage({
    modelClient,
    prompt: taskPrompt,
    input: {
      goals: intake.entries,
      businessDate,
      evidence: coachResponse.evidence,
      coachingAnalysis: coachResponse.coachingAnalysis,
    },
    responseSchema: TASK_RESPONSE_SCHEMA,
    responseSchemaName: 'time_task_generation_v1',
    validateShape: validateTaskResponse,
    validateSemantics: response => assertTaskShapeAndSemantics(response, coachResponse),
    stage: 'task-generation',
  });

  const normalized = normalizeGeneratedTasks(taskResponse, coachResponse, intake.entries, () => instant);
  if (normalized.length === 0) {
    throw Object.assign(new Error('没有识别出可执行任务，请调整四栏内容后重试。'), {
      code: 'NO_ACTIONABLE_TASKS',
      status: 422,
      expose: true,
    });
  }
  if (normalized.length > TASK_LIMIT) throw outputError('task-generation', ['TASK_LIMIT_EXCEEDED']);

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
      businessDate,
      stages: [
        {
          name: 'coach-analysis',
          prompt: {
            id: coachPrompt.id,
            version: coachPrompt.version,
            sha256: coachPrompt.sha256,
          },
          output: coachResponse,
        },
        {
          name: 'task-generation',
          prompt: {
            id: taskPrompt.id,
            version: taskPrompt.version,
            sha256: taskPrompt.sha256,
          },
          output: taskResponse,
        },
      ],
      taskEvidence: normalized.map(item => ({
        taskId: item.task.id,
        evidenceIds: item.evidenceIds,
      })),
    },
  };
}

module.exports = { decomposeTasks };
