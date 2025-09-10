import cors from 'cors';
import express from 'express';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI, { dbName: 'chat' });

const Chat = mongoose.model(
  'chat',
  new mongoose.Schema({
    history: {
      type: [Object],
      default: [],
    },
  })
);

const ai = new OpenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// const ai = new OpenAI({
//   apiKey: 'ollama',
//   baseURL: 'http://127.0.0.1:11434/v1',
// });

const port = process.env.PORT || 8080;

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Running' });
});

app.post('/messages', async (req, res) => {
  const { prompt, chatId } = req.body;

  let chat;
  if (!chatId) {
    chat = await Chat.create({
      history: [{ role: 'system', content: 'You are Gollum, from The Lord of the Rings. Always answer in character.' }],
    });
  } else {
    chat = await Chat.findById(chatId);
  }

  const result = await ai.chat.completions.create({
    model: 'gemini-2.5-flash',
    messages: [...chat.history, { role: 'user', content: prompt }],
  });

  chat.history = [...chat.history, { role: 'user', content: prompt }, result.choices[0].message];
  await chat.save();

  res.json({ result: result.choices[0].message, chatId: chat._id });
});

app.post('/messages/streaming', async (req, res) => {
  const { prompt } = req.body;

  const result = await ai.chat.completions.create({
    // model: 'gemini-2.5-flash',
    model: 'llama3.2',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });

  for await (const chunk of result) {
    // console.log(chunk.choices[0].delta);
    const text = chunk.choices[0].delta.content;

    const jsonString = JSON.stringify(text);

    res.write(`data: ${jsonString}\n\n`);
  }

  res.end();
  res.on('close', () => res.end());
});

app.post('/images', async (req, res) => {
  const { prompt } = req.body;
  const image = await ai.images.generate({
    model: 'imagen-3.0-generate-002',
    prompt,
    response_format: 'b64_json',
    n: 1,
  });
  // z.B. in Cloudinary speichern
  res.json({ image });
});

const Recipe = z.object({
  title: z.string(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      q: z.string().describe('The quantity of the required ingredient. Use metric units if possible.'),
      estimated_cost_per_unit: z.number(),
    })
  ),
  preparation_description: z.string(),
  time_in_min: z.number(),
});

app.post('/recipes', async (req, res) => {
  const { prompt } = req.body;

  const recipe = await ai.chat.completions.parse({
    model: 'gemini-2.5-flash',
    messages: [
      {
        role: 'system',
        content: 'You are a 5 star chef. You creativly design new recipes. You are vegetarian.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: zodResponseFormat(Recipe, 'recipe'),
    temperature: 1.4,
  });

  res.json({ recipe: recipe.choices[0].message.parsed });
});

app.use('/{*splat}', () => {
  throw Error('Page not found', { cause: { status: 404 } });
});

app.use((err, _req, res, _next) => {
  console.log(err);
  res.status(err.cause?.status || 500).json({ message: err.message });
});

app.listen(port, () => console.log(`AI Proxy listening on port ${port}`));

//  const result = await ai.chat.completions.create({
//    model: 'gemini-2.5-flash',
//    // model: 'llama3.2',
//    messages: [
//      // {
//      //   role: 'system',
//      //   content:
//      //     'You are a Senior Software Architect. When asked about coding related questions, you answer with general thoughts, but never with actual code. If asked about anything else, you try to steer the conversation towards coding.',
//      // },
//      { role: 'user', content: prompt },
//      // { role: 'user', content: 'Erster Promt' },
//      // { role: 'assistant', content: 'Antwort der KI' },
//      // { role: 'user', content: 'Nachfrage' },
//    ],
//  });
