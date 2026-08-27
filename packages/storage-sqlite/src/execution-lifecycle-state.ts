import type {
  TaskId,
  TaskVersion,
  WorkflowObligation,
} from '@dsh-military/contracts'
import type {
  ExecutionLifecycleStateStore,
  TaskExecutionLifecycleAggregate,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

const WORKFLOW_NAMESPACE = 'execution-workflow-obligation'
const TASK_NAMESPACE = 'execution-task-lifecycle'

/** SQLite CAS provider for Workflow / Attempt / Activation / Dispatch state. */
export class SqliteExecutionLifecycleStateStore
implements ExecutionLifecycleStateStore {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async readWorkflow(
    obligationId: string,
  ): Promise<WorkflowObligation | null> {
    return await this.#records.read(WORKFLOW_NAMESPACE, obligationId)
  }

  async listWorkflows(): Promise<readonly WorkflowObligation[]> {
    return this.#records.listSync<WorkflowObligation>(WORKFLOW_NAMESPACE)
  }

  async updateWorkflow<R>(
    obligationId: string,
    initial: () => WorkflowObligation,
    mutate: (
      current: WorkflowObligation,
    ) => Promise<{ readonly next: WorkflowObligation; readonly result: R }>
      | { readonly next: WorkflowObligation; readonly result: R },
  ): Promise<R> {
    return await this.#records.update(
      WORKFLOW_NAMESPACE,
      obligationId,
      initial,
      mutate,
    )
  }

  async readTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskExecutionLifecycleAggregate | null> {
    return await this.#records.read(
      TASK_NAMESPACE,
      taskKey(taskId, taskVersion),
    )
  }

  async listTasks(): Promise<readonly TaskExecutionLifecycleAggregate[]> {
    return this.#records.listSync<TaskExecutionLifecycleAggregate>(
      TASK_NAMESPACE,
    )
  }

  async updateTask<R>(
    taskId: TaskId,
    taskVersion: TaskVersion,
    initial: () => TaskExecutionLifecycleAggregate,
    mutate: (
      current: TaskExecutionLifecycleAggregate,
    ) => Promise<{
      readonly next: TaskExecutionLifecycleAggregate
      readonly result: R
    }> | {
      readonly next: TaskExecutionLifecycleAggregate
      readonly result: R
    },
  ): Promise<R> {
    return await this.#records.update(
      TASK_NAMESPACE,
      taskKey(taskId, taskVersion),
      initial,
      mutate,
    )
  }
}

function taskKey(taskId: TaskId, taskVersion: TaskVersion): string {
  return `${String(taskId)}@${Number(taskVersion)}`
}
