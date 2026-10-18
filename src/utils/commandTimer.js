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
 * Strips snowflakes and query parameters from Discord API route paths to avoid leaking IDs or tokens.
 *
 * @param {string} fullRoute
 * @returns {string}
 */
export function sanitizeRoute(fullRoute) {
  if (!fullRoute) return 'unknown';
  return fullRoute
    .split('?')[0]
    .replace(/\/\d{16,21}/g, '/:id');
}

// Active command tracker for correlating Discord.js REST requests to commands
let activeCommandContext = null;

/**
 * Sets or clears the currently executing command context for REST request correlation.
 *
 * @param {object|null} context
 */
export function setActiveCommandContext(context) {
  activeCommandContext = context;
}

/**
 * Returns the currently active command context, if any.
 *
 * @returns {object|null}
 */
export function getActiveCommandContext() {
  return activeCommandContext;
}

/**
 * Attaches REST request diagnostic instrumentation to a discord.js Client.
 * Measures single REST request duration, route, and status code independently.
 *
 * @param {import('discord.js').Client} client
 * @param {object} [options]
 * @param {Function} [options.logWriter=console.log]
 * @param {boolean} [options.enabled]
 */
export function attachRestDiagnostics(client, {
  logWriter = console.log,
  enabled = config.commandTimingLogs,
} = {}) {
  if (!client?.rest || client._restDiagnosticsAttached) return;
  client._restDiagnosticsAttached = true;

  const originalRequest = client.rest.request.bind(client.rest);

  client.rest.request = async function instrumentedRequest(options) {
    if (!enabled) {
      return originalRequest(options);
    }

    const start = performance.now();
    const method = (options?.method || 'GET').toUpperCase();
    const route = sanitizeRoute(options?.fullRoute || options?.route || 'unknown');
    const command = getActiveCommandContext();

    try {
      const response = await originalRequest(options);
      const duration = performance.now() - start;

      // Track into active command if one is running
      if (command && typeof command.recordRestRequest === 'function') {
        command.recordRestRequest({ method, route, duration, status: 200 });
      }

      const cmdTag = command ? ` cmd=${command.name}` : '';
      logWriter(`[REST REQ] method=${method} route=${route} duration=${duration.toFixed(1)}ms status=200${cmdTag}`);
      return response;
    } catch (error) {
      const duration = performance.now() - start;
      const status = error?.status || error?.rawError?.status || 'ERR';

      if (command && typeof command.recordRestRequest === 'function') {
        command.recordRestRequest({ method, route, duration, status });
      }

      const cmdTag = command ? ` cmd=${command.name}` : '';
      logWriter(`[REST REQ] method=${method} route=${route} duration=${duration.toFixed(1)}ms status=${status}${cmdTag}`);
      throw error;
    }
  };
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
 *   getStats: () => object,
 *   executeWithTiming: (executeFn: Function, ...args: any[]) => Promise<any>,
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
  let voiceReadyDuration = 0;
  let loggedEnd = false;
  const restRequests = [];

  const commandContext = {
    name,
    type,
    recordRestRequest: (req) => {
      restRequests.push(req);
    },
    recordVoiceReadyDuration: (duration) => {
      voiceReadyDuration += duration;
    },
  };

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
      const grossExecution = executionStart > 0 ? Math.max(0, (executionEnd || now) - executionStart) : 0;
      const totalDuration = Math.max(0, now - dispatchStart);
      const responseDuration = Math.max(0, totalResponseDeliveryDuration);
      // Net execution isolates application logic by subtracting awaited response delivery
      const netExecution = Math.max(0, grossExecution - responseDuration);

      let logLine = `[CMD END] name=${name} type=${type} execution=${grossExecution.toFixed(1)}ms net_execution=${netExecution.toFixed(1)}ms total=${totalDuration.toFixed(1)}ms status=${status}`;

      if (responseCount > 0) {
        logLine += ` response=${responseDuration.toFixed(1)}ms`;
      }

      if (voiceReadyDuration > 0) {
        logLine += ` voice_ready=${voiceReadyDuration.toFixed(1)}ms`;
      }

      if (restRequests.length > 0) {
        logLine += ` rest_calls=${restRequests.length}`;
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

    // Attach reference so downstream components (like VoiceManager) can record timings if running inside this command
    context._commandTimer = commandContext;

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
      voiceReadyDuration,
      restRequests,
    }),
    async executeWithTiming(executeFn, ...args) {
      logStart();
      instrumentContext();
      setActiveCommandContext(commandContext);

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
      } finally {
        setActiveCommandContext(null);
      }
    },
  };
}
