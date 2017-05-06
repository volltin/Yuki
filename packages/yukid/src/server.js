#!/usr/bin/node

'use strict'

import Koa from 'koa'
import Promise from 'bluebird'
import mongoose from 'mongoose'
import routes from './routes'
import CONFIG from './config'
import logger from './logger'
import scheduler from './scheduler'
import { User } from './models'
import { createMeta } from './repositories'
import { cleanImages, cleanContainers, updateImages } from './containers'
import { IS_TEST } from './globals'

const app = new Koa()
const server = require('http').createServer(app.callback())
const io = require('socket.io')(server)
io.on('connection', (socket) => {
  require('./ws/shell')(socket)
})

app.use(routes)
app.on('error', (err) => {
  console.error('Uncaught error: ', err)
})

const dbopts = {
  user: CONFIG.DB_USER,
  pass: CONFIG.DB_PASSWD,
  promiseLibrary: Promise,
}
mongoose.Promise = Promise

if (IS_TEST) {
  mongoose.connect('127.0.0.1', 'test')
} else {
  mongoose.connect('127.0.0.1', CONFIG.DB_NAME, CONFIG.DB_PORT, dbopts)
}
logger.info('Connected to MongoDB')

const listening = server.listen(CONFIG.API_PORT, CONFIG.API_ADDR, () => {
  const addr = listening.address()
  logger.info(`listening on ${addr.address}:${addr.port}`)
})

if (!IS_TEST) {
  logger.info('Cleaning containers')

  cleanContainers()
  .then(() => scheduler.schedRepos())
  .catch((err) => logger.error('Cleaning containers: %s', err))

  scheduler.addCusJob('updateImages', CONFIG.IMAGES_UPDATE_INTERVAL, () => {
    logger.info('Updating images')
    updateImages()
    .then(cleanImages, (err) => {
      logger.error('Pulling images: %s', err)
    })
    .catch((err) => {
      logger.error('Cleaning images: %s', err)
    })
  })
  logger.info('images-update scheduled')

  createMeta()
  .catch((e) => logger.error('createMeta: %s', e))

  User.findOne()
  .then((user) => {
    if (user === null) {
      return User.create({
        // root:root
        name: 'root',
        password: '63a9f0ea7bb98050796b649e85481845',
        admin: true
      })
    }
  })
  .then((root) => {
    if (root) {
      logger.warn('User `root` with password `root` has been created.')
    }
  })
  .catch((err) => {
    logger.error('Creating user <root> in empty db: %s', err)
  })
}