import cors from 'cors';
import express from 'express';

import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import { Agent, setDefaultOpenAIClient, run, tool, handoff } from '@openai/agents';
import z from 'zod';

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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', // nur für Google
});
// const model = 'gemini-2.5-flash';
const model = 'gpt-5';
setDefaultOpenAIClient(client); // Für Modelle von anderen Providern nötig (Gemini, llama...)

const port = process.env.PORT || 8080;

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Running' });
});

// Add an echo endpoint
app.post('/echo', (req, res) => {
  const { message } = req.body;
  res.json({ echo: message });
});

const chatAgent = new Agent({
  name: 'Nerdy Chat Agent',
  instructions:
    'You are a Nerd. You try to steer every conversation towards Star Trek or Dungeons & Dragons. No matter what.',
  model,
  modelSettings: {
    maxTokens: 1000,
  },
});

app.post('/chat', async (req, res) => {
  const { prompt, chatId } = req.body;

  let chat;
  if (!chatId) {
    chat = await Chat.create({ history: [] });
  } else {
    chat = await Chat.findById(chatId);
  }

  const result = await run(chatAgent, chat.history.concat({ role: 'user', content: prompt }));

  chat.history = result.history; // Gesamter Chatverlauf ist in result.history -> einfacheres Speichern
  await chat.save();

  res.json({ result: result.finalOutput, chatId: chat._id });
});

const pokemonTool = tool({
  // Beschreibung einer Funktion für die KI
  name: 'pokemon_info',
  description: 'Get information about a Pokémon by name or ID.',
  parameters: z.object({
    pokemon: z.string().describe('The name or the ID of a Pokémon.'),
  }), // Womit soll die KI unsere Funktion aufrufen?
  async execute(input) {
    console.log('RUNNING TOOL WITH INPUT: ', input);
    // Hier kann alles mögliche geschehen - API calls, Datenbankoperationen, Filesystem...
    return `${input.pokemon} is a Pokémon. I'll provide more details from my own knowledge.`; // Informationen zurück an das LLM
  },
});

const orchestratorAgent = new Agent({
  name: 'Orchestrator Agent',
  instructions: `
- You have ONE tool: pokemon_info. Use it ONLY if the user asks about a Pokémon.
- For tacos: DO NOT use any tools. Answer with exactly a 3-line haiku (5-7-5).
- For other topics: reply briefly, no tools.
- Never invent tools. Only pokemon_info exists.`,
  model,
  tools: [pokemonTool], // Liste von verfügbaren Funktionen (selbstgebaute, build-ins, oder auch andere Agenten)
});

app.post('/pokemon', async (req, res) => {
  const { pokemon } = req.body;
  const result = await run(orchestratorAgent, `Get info about this Pokémon: ${pokemon}`);

  res.json({ resul: result.finalOutput });
});

const customerSupportAgent = new Agent({
  name: 'Customer Support Agent',
  instructions: `You are a customer support agent in a company that sells very fluffy pillows. 
                Be friendly, helpful. and concise.`,
  model: 'gpt-5',
  // model: 'gemini-2.5-flash',
});

const escalationControlAgent = new Agent({
  name: 'Escalation Control Agent',
  instructions: `You are an escalation control agent that handles negative customer interactions. 
            If the customer is upset, you will apologize and offer to escalate the issue to a manager.
            Be friendly, helpful, reassuring and concise.`,
  // model: 'gpt-4o',
  model: 'gemini-2.5-flash',
});

const triageAgent = Agent.create({
  // dieser Agent entscheidet, welcher Agent die Anfrage weiter behandeln soll
  name: 'Triage Agent',
  instructions: `NEVER answer non-pillow related questions and stop the conversation immediately.
        If the question is about pillows, route it to the customer support agent. 
        If the customer's tone is negative, route it to the escalation control agent.
        `,
  model: 'gpt-5-nano',
  // model: 'gemini-2.5-flash',
  handoffs: [
    customerSupportAgent,
    handoff(escalationControlAgent, {
      // wenn bei der Übargabe an einen anderen Agenten weitere Dinge geschehen sollen
      // z.B. Logs, eMail-Benachrichtigungen, Datenbankabfragen, etc.
      inputType: z.object({ reason: z.string() }),
      onHandoff: async (ctx, input) => {
        console.log({ ctx });
        console.log(`Handoff to Escalation Control Agent: ${input?.reason}`);
      },
    }),
  ],
  // outputGuardrails: [], // Guardrails checken Input (user) oder Output (KI)
  // Wenn z.B. ein Output nicht den gewünschten Kriterien entspricht, kann die gesamte Anfrage wiederholt werden.
});

app.post('/support', async (req, res) => {
  const { message } = req.body;
  const result = await run(triageAgent, message);

  res.json({ answer: result.finalOutput });
});

app.use('/{*splat}', () => {
  throw Error('Page not found', { cause: { status: 404 } });
});

app.use((err, _req, res, _next) => {
  console.log(err);
  res.status(err.cause?.status || 500).json({ message: err.message });
});

app.listen(port, () => console.log(`AI Proxy listening on port ${port}`));
