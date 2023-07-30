import { MessagePort, Worker, isMainThread } from 'node:worker_threads';
import { ConsoleLogger, createConsoleLogger } from './logger.js';

export type WorkerError = {
  name: string;
  message: string;
  stack: string;
};

export type WorkerBaseMessage<Method> = {
  id: number;
  method: Method;
  ack: string | null;
};

export type WorkerSuccessMessage<Method, Body> = WorkerBaseMessage<Method> & {
  body: Body;
  error: null;
};

export type WorkerFailureMessage<Method> = WorkerBaseMessage<Method> & {
  body: null;
  error: WorkerError;
};

export type WorkerMessage<Method, Body> =
  | WorkerSuccessMessage<Method, Body>
  | WorkerFailureMessage<Method>;

export type AnyMessage = WorkerMessage<any, any>;

export type WorkerMessageMethod<T extends AnyMessage> = T extends WorkerMessage<
  infer R,
  any
>
  ? R
  : never;

export type WorkerMessageBody<T extends AnyMessage> =
  T extends WorkerSuccessMessage<any, infer R> ? R : never;

export type WorkerBuiltinMethod =
  | 'worker/open'
  | 'worker/close'
  | 'worker/ack'
  | 'worker/any';

type WorkerInternalMethod<T extends AnyMessage> =
  | WorkerMessageMethod<T>
  | WorkerBuiltinMethod;

export type WorkerReceiveResult<T extends AnyMessage> =
  | {
      state: 'success';
      body: WorkerMessageBody<T>;
    }
  | {
      state: 'failure';
      error: WorkerError;
    };

export type WorkerReceiveAnyResult<T extends AnyMessage> =
  | {
      state: 'success';
      method: WorkerMessageMethod<T>;
      body: WorkerMessageBody<T>;
    }
  | {
      state: 'failure';
      method: WorkerMessageMethod<T>;
      error: WorkerError;
    };

type WorkerResolver<T extends AnyMessage> = {
  resolve: (body: WorkerMessageBody<T>) => void;
  reject: (error: WorkerError) => void;
};

type ConnectionState<T extends AnyMessage> = {
  promise: Promise<T> | null;
  resolver: WorkerResolver<AnyMessage> | null;
};

export type WorkerConnectionPort = Worker | MessagePort;

class WorkerConnection<T extends AnyMessage = AnyMessage> {
  private state: Map<string, ConnectionState<T>> = new Map();

  public constructor(
    private port: WorkerConnectionPort,
    public id: number,
    private logger: ConsoleLogger,
  ) {}

  public dispose(): void {
    this.state.clear();
  }

  public async open(timeout: number): Promise<void> {
    const method = 'worker/open';
    this.postMessage({
      body: null,
      error: null,
      method,
      ack: null,
    });
    this.produce(method);
    await Promise.race([
      this.consume(method),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `#${this.id} connection could not be opened due to timeout. (${timeout}ms)`,
            ),
          );
        }, timeout);
      }),
    ]);
  }

  public async close(): Promise<void> {
    const method = 'worker/close';
    this.postMessage({
      body: null,
      error: null,
      method,
      ack: null,
    });
    this.produce(method);
    await this.consume(method);
    this.dispose();
  }

  public ack(method: WorkerInternalMethod<T>): void {
    this.postMessage({
      body: null,
      error: null,
      method: 'worker/ack',
      ack: method,
    });
  }

  public produce(method: WorkerInternalMethod<T>): void {
    const state: ConnectionState<T> = {
      promise: null,
      resolver: null,
    };
    state.promise = new Promise((resolve, reject) => {
      state.resolver = { resolve, reject };
    });
    this.state.set(method, state);
  }

  public resolve(method: WorkerInternalMethod<T>, message: AnyMessage): void {
    const state = this.state.get(method);
    if (state === undefined) {
      throw new Error(
        `connection state not exists (${isMainThread ? 'MAIN' : 'WORKER'})`,
      );
    }

    const resolver = state.resolver;
    this.state.delete(method);

    if (message.error !== null) {
      resolver?.reject(message.error);
    } else {
      resolver?.resolve(message);
    }
  }

  public async consume(method: WorkerInternalMethod<T>): Promise<T> {
    const state = this.state.get(method);
    if (state === undefined || state.promise === null) {
      throw new Error(
        `connection state not exists (${isMainThread ? 'MAIN' : 'WORKER'})`,
      );
    }

    const promise = state.promise;
    state.promise = null;

    try {
      const result = await promise;
      return result;
    } catch (e: any) {
      const msg: WorkerFailureMessage<string> = {
        id: this.id,
        body: null,
        error: Object.assign(e, { ...e }),
        ack: null,
        method,
      };
      return msg as T;
    }
  }

  public send(
    method: WorkerMessageMethod<T>,
    body: WorkerMessageBody<T> | null,
    error: unknown | null,
  ): void {
    if (body !== null && error === null) {
      this.postMessage({
        body,
        error: null,
        method,
        ack: null,
      });
    } else if (body === null && error !== null) {
      this.postMessage({
        body: null,
        error: Object.assign(error as never, { ...error }),
        method,
        ack: null,
      });
    }
    this.produce(method);
  }

  public async receive(
    method: WorkerMessageMethod<T>,
  ): Promise<WorkerReceiveResult<T>> {
    if (!this.state.has(method)) {
      this.produce(method);
    }

    const message = await this.consume(method);
    this.logger.debug('receive', {
      method: message.method,
      ack: message.ack,
    });

    return this.message2result(message);
  }

  public async receiveAny(): Promise<WorkerReceiveAnyResult<T>> {
    const method = 'worker/any';

    if (!this.state.has(method)) {
      this.produce(method);
    }

    const message = await this.consume(method);
    const result = this.message2result(message);

    return {
      ...result,
      method: message.method,
    };
  }

  private message2result<T extends AnyMessage>(
    message: T,
  ): WorkerReceiveResult<T> {
    return message.error === null
      ? {
          state: 'success',
          body: message.body,
        }
      : {
          state: 'failure',
          error: message.error,
        };
  }

  private postMessage(msg: Omit<AnyMessage, 'id'>): void {
    this.logger.debug('post', {
      method: msg.method,
      ack: msg.ack,
    });
    this.port.postMessage({
      id: this.id,
      ...msg,
    });
  }
}

export type WorkerConnector = {
  dispose: () => void;
  wait: <T extends AnyMessage>() => Promise<WorkerConnection<T>>;
  connect: <T extends AnyMessage>(
    timeout?: number,
  ) => Promise<WorkerConnection<T>>;
};

export const createWorkerConnector = (
  port: WorkerConnectionPort,
  debug: boolean,
): WorkerConnector => {
  const idleConnections: WorkerConnection[] = [];
  const activeConnections = new Map<number, WorkerConnection>();
  const logger = createConsoleLogger(debug);
  let _id = 0;

  const onMessage = (message: AnyMessage) => {
    logger.debug('listener', {
      method: message.method,
      ack: message.ack,
    });

    switch (message.method) {
      case 'worker/open': {
        const conn = idleConnections.shift();
        if (conn === undefined) {
          throw new Error('idle connection not exists');
        }
        conn.id = message.id;
        activeConnections.set(conn.id, conn);
        conn.ack(message.method);
        conn.resolve(message.method, message);
        break;
      }
      case 'worker/close': {
        const conn = activeConnections.get(message.id);
        if (conn !== undefined) {
          activeConnections.delete(conn.id);
          conn.ack(message.method);
          conn.dispose();
        }
        break;
      }
      case 'worker/ack': {
        const conn = activeConnections.get(message.id);
        if (conn === undefined) {
          throw new Error(`"${message.id}" connection not exists`);
        }
        if (message.ack === 'worker/close') {
          activeConnections.delete(message.id);
        }
        conn.resolve(message.ack!, message);
        break;
      }
      default: {
        const conn = activeConnections.get(message.id);
        if (conn !== undefined) {
          try {
            conn.resolve(message.method, message);
          } catch (e) {
            conn.resolve('worker/any', message);
          }
        }
        break;
      }
    }
  };

  const onError = (e: Error) => {
    logger.error('onError', e.stack);
  };

  port.on('message', onMessage);
  port.on('error', onError);

  return {
    dispose: () => {
      idleConnections.length = 0;
      activeConnections.clear();
      port.off('message', onMessage);
      port.off('error', onError);
    },

    wait: async () => {
      const method = 'worker/open';
      const conn = new WorkerConnection<any>(port, 0, logger);
      idleConnections.push(conn);
      conn.produce(method);
      await conn.consume(method);
      return conn;
    },

    connect: async (timeout = 3000) => {
      const id = _id++;
      const conn = new WorkerConnection<any>(port, id, logger);
      activeConnections.set(id, conn);
      await conn.open(timeout);
      return conn;
    },
  };
};
