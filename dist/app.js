"use strict";

/**
 * Generic Webhook to NATS Streaming CLI app.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module app
 */
const STAN = require('node-nats-streaming');

module.exports = async log => {
  const app = {
    taskSeconds: 0
  };

  const handleError = err => {
    log.error(`Task error\n  ${err}`);
  };

  const runTask = async () => {
    const {
      stan
    } = app;
    log.info('Task running...');
    if (!stan) return;
    if (stan.isConnected) return;
    if (stan.instance) stan.instance.removeAllListeners();
    log.info('NATS Streaming connecting');
    stan.instance = STAN.connect(stan.cluster, stan.client, stan.opts || {});
    stan.instance.once('connection_lost', () => {
      stan.isConnected = false;
      log.info('NATS Streaming connection lost');
    });
    stan.instance.once('connect', () => {
      stan.isConnected = true;
      log.info('NATS Streaming connected');
    });
    stan.instance.on('error', err => {
      log.error(`NATS Streaming error\n  ${err}`);
    });
  };

  const scheduleTask = () => {
    log.info(`Task starting in ${app.taskSeconds} seconds`);
    app.taskTid = setTimeout(() => {
      runTask().catch(handleError).then(scheduleTask);
    }, app.taskSeconds * 1000);
  }; // App setup


  app.eval = async p => {
    if (!p.secret) throw new Error('Required: secret');
    app.stan = {
      cluster: p.stan_cluster,
      client: p.stan_client.replace(/\W/g, '_'),
      opts: {
        uri: p.stan_uri
      }
    };
    scheduleTask();
    app.taskSeconds = p.task_seconds;

    const fastify = require('fastify')();

    fastify.addHook('preHandler', (request, reply, done) => {
      if (request.headers.authorization === p.secret) done();else {
        reply.code(401);
        done(new Error('Unauthorized'));
      }
    });
    fastify.post('/', {
      schema: {
        body: {
          type: 'object'
        }
      }
    }, async (request, reply) => {
      const {
        id
      } = request;
      log.info(`Webhook data received ${id}`);
      if (!app.stan.instance) throw new Error('NATS Streaming not ready');
      if (!app.stan.isConnected) throw new Error('NATS Streaming not connected');
      const guid = await new Promise((resolve, reject) => {
        app.stan.instance.publish(p.subject, JSON.stringify(request.body), (err, guid) => {
          if (err) reject(new Error(`Publish error: ${err.message}`));else resolve(guid);
        });
      });
      log.info(`Webhook data published ${id} ${guid}`);
      return {
        id,
        guid
      };
    });
    const address = await fastify.listen(p.port);
    log.info(`Webhook listening on ${address}`);
    app.fastify = fastify;
  };

  app.stop = () => app.fastify && app.fastify.close();

  return app;
};