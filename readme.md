# Message queue iterator

An async iterator for a [RedisSMQ](https://github.com/smrchy/rsmq) message queue.

## Usage

The application must initialise a RedisSMQ client and give it to the QueueIterator.
The RedisSMQ client must have the `realtime` option set to `true` as the iterator will
subscribe to receive messages

```js
// index.js
import RedisSMQ from "rsmq";
import QueueIterator from "rsmq-iterator";

const rsmq = new RedisSMQ({
  /* host, port, ... */
  realtime: true
});
QueueIterator.rsmq(rsmq);
```

Create a class for the queue

```js
// MyQueue.js
import QueueIterator from "rsmq-iterator";
export default class MyQueue extends QueueIterator {}
```

The class can be used to send messages to the queue

```js
// somewhere.js
import MyQueue from "./MyQueue";

async function send(foo) {
  const job = await new MyQueue({ foo });
  const { id } = job.info();
  console.log(id);
}
send("a message");
```

The `send()` method can also be used to send messages to the queue

```js
// somewhere.js
import MyQueue from "./MyQueue";

const myQueue = new MyQueue();
async function send(foo) {
  const job = await myQueue.send({ foo });
  const { id } = job.info();
  console.log(id);
}
send("a message");
```

The class instance can be used to receive messages from the queue

```js
// somewhere-else.js
import MyQueue from "./MyQueue";

async function main() {
  for await (const job of new MyQueue()) {
    const { id } = job.info();
    console.log(id, job.data.foo);
    await job.done();
  }
}
main();
```

## Create queue

To create the queue use the `createQueue` method from the RedisSMQ client.

```js
// migration.js
const rsmq = new RedisSMQ({
  /* host, port, ... */
});
rsmq.createQueue({ qname: "MyQueue" });
```

## Customise

The behaviour of the iterator can be customised

```js
// MyQueue.js
import QueueIterator from "rsmq-iterator";

class MyQueue extends QueueIterator {
  // (optional) override the name of the queue to send/receive messages to/from
  // defaults to the class name
  queueName = "MyQueue";

  // (optional) custom message serialization
  // the default is JSON.stringify
  async serialize(message) {
    return super.serialize(message);
  }

  // (optional) custom message serialization
  // the default is JSON.parse
  async deserialize(message) {
    return super.deserialize(message);
  }
}
```
