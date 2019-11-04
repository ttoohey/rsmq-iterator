const RSMQ = Symbol("RSMQ");
const QName = Symbol("QName");
const Iterator = Symbol("Iterator");
const Blocks = Symbol("Blocks");
const ReceiveMessage = Symbol("ReceiveMessage");
const Connected = Symbol("Connected");

const noop = () => undefined;

function createTimer() {
  let timeoutID;
  const set = (callback, delay = 0) =>
    clear() && (timeoutID = setTimeout(callback, delay));
  const clear = () => (timeoutID && clearTimeout(timeoutID)) || true;
  return [set, clear];
}

class QueueAsyncIterable {
  constructor(iterator) {
    this[Iterator] = iterator;
    this[Blocks] = { [ReceiveMessage]: noop, [Connected]: noop };
    const rsmq = iterator[RSMQ];
    rsmq.redis.on("connect", () => this.subscribe());
    if (rsmq.redis.connected) {
      this[Connected] = Promise.resolve();
      this.subscribe();
    } else {
      this[Connected] = this.block(Connected);
      rsmq.redis.on("connect", () => this.unblock(Connected));
    }
  }

  async next() {
    await this[Connected];
    const parse = this[Iterator].deserialize;
    const response = await this.receiveMessage();
    if (!response) {
      return { done: true };
    }
    const { id, message } = response;
    const data = await parse(message);
    const done = () => this.deleteMessage(id);
    const info = () => response;
    const value = { data, done, info };
    return { value };
  }

  subscribe() {
    const unblock = () => this.unblock(ReceiveMessage);
    const done = () => {
      const { retry_delay, retry_backoff } = rsmq.redis;
      const [setDelay] = createTimer();
      const delayUnblock = ({ delay }) =>
        setDelay(unblock, delay * retry_backoff + 100);
      rsmq.redis.on("reconnecting", delayUnblock);
      rsmq.redis.once("connect", () => {
        rsmq.redis.off("reconnecting", delayUnblock);
        setDelay(unblock);
      });
      setDelay(unblock, retry_delay * retry_backoff + 100);
    };
    const qname = this[Iterator][QName];
    const rsmq = this[Iterator][RSMQ];
    const subscriber = rsmq.redis.duplicate();
    rsmq.redis.once("end", () => subscriber.quit(done));
    subscriber.on("message", unblock);
    subscriber.subscribe(`${rsmq.redisns}rt:${qname}`);
  }

  block(key) {
    return new Promise(resolve => (this[Blocks][key] = resolve));
  }

  unblock(key) {
    const resolve = this[Blocks][key];
    this[Blocks][key] = noop;
    resolve();
  }

  async receiveMessage() {
    const qname = this[Iterator][QName];
    const rsmq = this[Iterator][RSMQ];
    let response = await rsmq.receiveMessageAsync({ qname });
    while (!response.id) {
      await this.block(ReceiveMessage);
      if (!rsmq.redis.connected) {
        return undefined;
      }
      response = await rsmq.receiveMessageAsync({ qname });
    }
    return response;
  }

  async deleteMessage(id) {
    const qname = this[Iterator][QName];
    const rsmq = this[Iterator][RSMQ];
    return await rsmq.deleteMessageAsync({ qname, id });
  }
}

class QueueIterator {
  // initialise message queue provider
  static rsmq(rsmq) {
    this[RSMQ] = rsmq;
  }

  constructor(data) {
    if (data !== undefined) {
      return this.send(data);
    }
  }

  // override with the name of the message queue
  get queueName() {
    return this.constructor.name;
  }

  serialize(data) {
    return JSON.stringify(data);
  }

  deserialize(message) {
    return JSON.parse(message);
  }

  get [RSMQ]() {
    return this.constructor[RSMQ];
  }

  get [QName]() {
    return this.queueName;
  }

  [Symbol.asyncIterator]() {
    return new QueueAsyncIterable(this);
  }

  // send a message
  async send(data) {
    const qname = this[QName];
    const rsmq = this[RSMQ];
    const message = await this.serialize(data);
    const id = await rsmq.sendMessageAsync({ qname, message });
    const done = () => rsmq.deleteMessageAsync({ qname, id });
    const info = () => ({ id, message });
    return { data, done, info };
  }
}

export default QueueIterator;
