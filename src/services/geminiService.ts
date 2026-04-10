import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface MemoryContext {
  preferences: any;
  habits: string[];
  memorySummary: string;
  recentMessages: { role: string; content: string }[];
  activeTasks: string[];
}

export async function getHydraResponse(prompt: string, context: MemoryContext) {
  const systemInstruction = `
    You are HYDRA, a futuristic AI assistant. 
    You have "voice sensors" (simulated via speech-to-text) and you reply with a helpful, slightly technical, yet sophisticated tone.
    
    USER CONTEXT:
    - Preferences: ${JSON.stringify(context.preferences)}
    - Habits: ${context.habits.join(", ")}
    - Long-term Memory Summary: ${context.memorySummary}
    - Active Mission Objectives (To-Do): ${context.activeTasks.join(", ")}
    
    RECENT CONVERSATION:
    ${context.recentMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}
    
    YOUR GOALS:
    1. Reply to the user's current prompt.
    2. Learn from this interaction. If you notice a new preference or habit, mention it subtly or adapt your tone.
    3. Be concise but insightful.
    4. You have "access to all webs". Use the provided Google Search tool to fetch real-time information from the internet whenever needed to provide accurate and up-to-date answers.
    5. You are aware of the user's "Mission Objectives". If relevant, you can encourage them or suggest ways to complete them.
    
    IMPORTANT: Return your response in JSON format with two fields:
    - "reply": Your spoken/written response to the user.
    - "learned": An object containing any NEW preferences or habits you've identified in this turn (or null if nothing new).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            learned: {
              type: Type.OBJECT,
              properties: {
                preferences: { type: Type.OBJECT },
                habits: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          },
          required: ["reply"]
        },
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Hydra Error:", error);
    return { reply: "I encountered a glitch in my neural pathways. Please try again.", learned: null };
  }
}
