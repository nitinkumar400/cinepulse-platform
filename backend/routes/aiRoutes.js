const express = require('express');
const axios = require('axios');

const logger = require('../config/logger');
const { getEnv, getNumberEnv } = require('../config/env');

const OLLAMA_URL = getEnv('OLLAMA_URL', 'http://127.0.0.1:11434/api/generate');
const OLLAMA_MODEL = getEnv('OLLAMA_MODEL', 'llama3');
const OLLAMA_TIMEOUT_MS = getNumberEnv('OLLAMA_TIMEOUT_MS', 10 * 1000);

async function requestOllama(prompt, options = {}) {
  const client = options.client || axios;
  const response = await client.post(
    OLLAMA_URL,
    {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    },
    {
      timeout: OLLAMA_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  const result = typeof response?.data?.response === 'string'
    ? response.data.response.trim()
    : '';

  if (!result) {
    const error = new Error('Empty AI response');
    error.statusCode = 502;
    throw error;
  }

  return result;
}

function createAiRouters(options = {}) {
  const generateText = options.generateText || requestOllama;
  const routeLogger = options.logger || logger;

  const aiRouter = express.Router();

  aiRouter.post('/', async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string'
      ? req.body.prompt.trim()
      : '';

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required',
      });
    }

    try {
      const result = await generateText(prompt, { req });

      return res.json({
        success: true,
        result,
      });
    } catch (error) {
      routeLogger.error('AI route request failed', {
        message: error.message,
        statusCode: error.statusCode,
        stack: error.stack,
      });

      const status = error.code === 'ECONNABORTED'
        ? 504
        : (error.statusCode || error.response?.status || 502);

      return res.status(status).json({
        success: false,
        message: 'AI service unavailable',
      });
    }
  });

  return {
    aiRouter,
  };
}

const defaultRouters = createAiRouters();

module.exports = {
  ...defaultRouters,
  createAiRouters,
  requestOllama,
};
