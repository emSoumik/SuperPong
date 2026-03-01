
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    [key: string]: unknown;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: 'color:#888',
    info: 'color:#4ade80',
    warn: 'color:#facc15',
    error: 'color:#f87171',
};

function log(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    const style = LEVEL_COLORS[level];
    const fn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
            : level === 'debug' ? console.debug
                : console.log;

    if (context && Object.keys(context).length > 0) {
        fn(`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style, context);
    } else {
        fn(`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style);
    }
}

export const logger = {
    debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
    info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
    warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
    error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
};
