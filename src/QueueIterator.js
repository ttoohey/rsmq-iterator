import redis from "redis";

const RSMQ = Symbol("RSMQ");
const QName = Symbol("QName");
const Iterator = Symbol("Iterator");
const BlockResolve = Symbol("BlockResolve");

const noop = () => undefined;

class QueueAsyncIterable {
  constructor(iterator) {
    this[Iterator] = iterator;
    this[BlockResolve] = noop;
    this.subscribe();
  }

  async next() {
    const parse = this[Iterator].deserialize;
    const response = await this.receiveMessage();
    const { id, message } = response;
    const data = await parse(message);
    const done = () => this.deleteMessage(id);
    const info = () => response;
    const value = { data, done, info };
    return { value };
  }

  subscribe() {
    const qname = this[Iterator][QName];
    const rsmq = this[Iterator][RSMQ];
    const subscriber = redis.createClient(rsmq.redis.options);
    subscriber.on("message", () => this.unblock());
    subscriber.subscribe(`${rsmq.redisns}rt:${qname}`);
  }

  block() {
    return new Promise(resolve => (this[BlockResolve] = resolve));
  }

  unblock() {
    const resolve = this[BlockResolve];
    this[BlockResolve] = noop;
    resolve();
  }

  async receiveMessage() {
    const qname = this[Iterator][QName];
    const rsmq = this[Iterator][RSMQ];
    let response = await rsmq.receiveMessageAsync({ qname });
    while (!response.id) {
      await this.block();
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
