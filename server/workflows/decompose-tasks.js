const { checkIntake } = require('./check-intake');
const { checkTaskSmart } = require('./check-task-smart');
const { extractTasks } = require('./extract-tasks');

async function decomposeTasks({ entries, modelClient, requestBody, now } = {}) {
  const input = requestBody || { entries };
  const intake = checkIntake({ requestBody: input });
  const result = await extractTasks({
    goals: intake.entries,
    modelClient,
    now,
  });
  if (result.tasks.length === 0) {
    throw Object.assign(new Error('没有识别出可执行任务，请调整四栏内容后重试。'), {
      code: 'NO_ACTIONABLE_TASKS',
      status: 422,
      expose: true,
    });
  }
  const smart = checkTaskSmart({ tasks: result.tasks });
  return {
    intake: {
      lineCounts: intake.lineCounts,
      totalLines: intake.totalLines,
      warnings: intake.warnings,
    },
    tasks: result.tasks,
    smart,
  };
}

module.exports = { decomposeTasks };
