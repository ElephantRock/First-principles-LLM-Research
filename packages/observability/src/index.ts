export interface LogContext { requestId?: string; userId?: string; experimentId?: string; submissionId?: string }

export function logEvent(event: string, context: LogContext = {}, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...context, payload }));
}
