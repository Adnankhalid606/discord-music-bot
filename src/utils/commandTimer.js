import { performance } from 'node:perf_hooks';
import { config } from '../config/config.js';

/**
 * Sanitizes a string for single-line log output by removing newlines and control characters.
 *
 * @param {any} val
 * @returns {string}
 */
export function sanitizeLogValue(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Creates instrumented command execution and response monitoring wrappers.
 *
 * @param {object} params
 * @param {string} params.name - Command name
 * @param {'prefix' | 'slash'} params.type - Invocation type
 * @param {any} params.context - Discord Message or ChatInputCommandInteraction
 * @param {Function} [params.logWriter=console.log] - Output function for log lines
 * @param {boolean} [params.enabled] - Whether timing logs are enabled
 * @returns {{
 *   onDispatchStart: () => void,
 *   wrapExecute: (executeFn: Function, ...args: any[]) => Promise<any>,
 * }}
 */
export function createCommandExecutionTimer({
  name,
  type,
  context,
  logWriter = console.log,
  enabled = config.commandTimingLogs,
}) {
  const guildName = context?.guild?.name ? sanitizeLogValue(context.guild.name) : 'DM';

  // State trackers
  let dispatchStart = context?.receivedAt ?? performance.now();
  let executionStart = 0;
  let executionEnd = 0;
  let totalResponseDeliveryDuration = 0;
  let responseCount = 0;
  let loggedEnd = false;

  const logStart = () => {
    if (!enabled) return;
    try {
      logWriter(`[CMD START] name=${name} type=${type} guild=${guildName}`);
    } catch {}
  };

  const logEnd = ({ status, reason = null }) => {
    if (!enabled || loggedEnd) return;
    loggedEnd = true;

    try {
      const now = performance.now();
      const dispatchDelay = executionStart > 0 ? Math.max(0, executionStart - dispatchStart) : 0;
      const executionDuration = executionStart > 0 ? Math.max(0, (executionEnd || now) - executionStart) : 0;
      const totalDuration = Math.max(0, now - dispatchStart);
      const responseDuration = Math.max(0, totalResponseDeliveryDuration);

      let logLine = `[CMD END] name=${name} type=${type} execution=${executionDuration.toFixed(1)}ms total=${totalDuration.toFixed(1)}ms status=${status}`;

      if (responseCount > 0) {
        logLine += ` response=${responseDuration.toFixed(1)}ms`;
      }

      if (dispatchDelay > 0.05) {
        logLine += ` dispatch=${dispatchDelay.toFixed(1)}ms`;
      }

      if (reason) {
        logLine += ` reason="${sanitizeLogValue(reason)}"`;
      }

      logWriter(logLine);
    } catch {}
  };

  /**
   * Measures a response-sending promise and tracks response delivery duration.
   *
   * @param {() => Promise<any>} sendFn
   * @returns {Promise<any>}
   */
  const trackResponse = async (sendFn) => {
    const start = performance.now();
    try {
      return await sendFn();
    } finally {
      const duration = performance.now() - start;
      totalResponseDeliveryDuration += duration;
      responseCount++;
    }
  };

  /**
   * Instruments the context object (reply, deferReply, editReply, followUp)
   * without altering its public prototype or behavior.
   */
  const instrumentContext = () => {
    if (!context || typeof context !== 'object') return;

    const methods = ['reply', 'deferReply', 'editReply', 'followUp'];
    for (const method of methods) {
      if (typeof context[method] === 'function') {
        const originalMethod = context[method];
        context[method] = function (...args) {
          return trackResponse(() => originalMethod.apply(this, args));
        };
      }
    }
  };

  return {
    getStats: () => ({
      name,
      type,
      guildName,
      dispatchStart,
      executionStart,
      executionEnd,
      totalResponseDeliveryDuration,
      responseCount,
    }),
    async executeWithTiming(executeFn, ...args) {
      logStart();
      instrumentContext();

      executionStart = performance.now();

      try {
        const result = await executeFn(context, ...args);
        executionEnd = performance.now();
        logEnd({ status: 'success' });
        return result;
      } catch (error) {
        executionEnd = performance.now();
        const safeReason = error?.message || 'Execution error';
        logEnd({ status: 'failure', reason: safeReason });
        throw error;
      }
    },
  };
}
