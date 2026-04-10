import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Send, 
  Brain, 
  Database, 
  Settings, 
  LogOut, 
  LogIn,
  Cpu,
  Activity,
  Zap,
  History,
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
  ListTodo
} from 'lucide-react';
import { auth, db, signIn, signOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  serverTimestamp,
  getDocFromServer,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { getHydraResponse, MemoryContext } from './services/geminiService';

// --- Types ---
interface UserProfile {
  uid: string;
  displayName: string;
  preferences: any;
  habits: string[];
  memorySummary: string;
  updatedAt: any;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: any;
}

interface TodoTask {
  id: string;
  text: string;
  completed: boolean;
  createdAt: any;
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Firebase Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (e) {
          console.error("Firebase connection test failed:", e);
        }
      }
    });
    return unsubscribe;
  }, []);

  // --- Profile, Messages & Tasks Listeners ---
  useEffect(() => {
    if (!user) return;

    // Profile listener
    const profileRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        // Create initial profile
        const initialProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || 'User',
          preferences: {},
          habits: [],
          memorySummary: 'No previous interactions recorded.',
          updatedAt: serverTimestamp()
        };
        setDoc(profileRef, initialProfile);
      }
    });

    // Messages listener
    const messagesRef = collection(db, 'users', user.uid, 'messages');
    const qMessages = query(messagesRef, orderBy('timestamp', 'asc'), limit(50));
    const unsubMessages = onSnapshot(qMessages, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(msgs);
    });

    // Tasks listener
    const tasksRef = collection(db, 'users', user.uid, 'tasks');
    const qTasks = query(tasksRef, orderBy('createdAt', 'desc'));
    const unsubTasks = onSnapshot(qTasks, (snapshot) => {
      const tks = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TodoTask));
      setTasks(tks);
    });

    return () => {
      unsubProfile();
      unsubMessages();
      unsubTasks();
    };
  }, [user]);

  // --- Task Actions ---
  const addTask = async () => {
    if (!newTaskText.trim() || !user) return;
    const tasksRef = collection(db, 'users', user.uid, 'tasks');
    await addDoc(tasksRef, {
      uid: user.uid,
      text: newTaskText,
      completed: false,
      createdAt: serverTimestamp()
    });
    setNewTaskText('');
  };

  const toggleTask = async (task: TodoTask) => {
    if (!user) return;
    const taskRef = doc(db, 'users', user.uid, 'tasks', task.id);
    await updateDoc(taskRef, { completed: !task.completed });
  };

  const deleteTask = async (taskId: string) => {
    if (!user) return;
    const taskRef = doc(db, 'users', user.uid, 'tasks', taskId);
    await deleteDoc(taskRef);
  };

  // --- Scroll to bottom ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Voice Sensors (Speech Recognition) ---
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      handleSend(transcript);
    };

    recognition.start();
  };

  // --- Speech Synthesis (Voice Reply) ---
  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 0.8; // Futuristic deep tone
    window.speechSynthesis.speak(utterance);
  };

  // --- Handle Send ---
  const handleSend = async (text: string = input) => {
    if (!text.trim() || !user || isProcessing) return;

    setIsProcessing(true);
    setInput('');

    try {
      // 1. Save user message
      const messagesRef = collection(db, 'users', user.uid, 'messages');
      await addDoc(messagesRef, {
        uid: user.uid,
        role: 'user',
        content: text,
        timestamp: serverTimestamp()
      });

      // 2. Get Hydra response
      const context: MemoryContext = {
        preferences: profile?.preferences || {},
        habits: profile?.habits || [],
        memorySummary: profile?.memorySummary || '',
        recentMessages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        activeTasks: tasks.filter(t => !t.completed).map(t => t.text)
      };

      const result = await getHydraResponse(text, context);

      // 3. Save Hydra message
      await addDoc(messagesRef, {
        uid: user.uid,
        role: 'model',
        content: result.reply,
        timestamp: serverTimestamp()
      });

      // 4. Update profile if something was learned
      if (result.learned) {
        const profileRef = doc(db, 'users', user.uid);
        const newPreferences = { ...(profile?.preferences || {}), ...(result.learned.preferences || {}) };
        const newHabits = Array.from(new Set([...(profile?.habits || []), ...(result.learned.habits || [])]));
        
        await setDoc(profileRef, {
          preferences: newPreferences,
          habits: newHabits,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      // 5. Voice reply
      speak(result.reply);

    } catch (error) {
      console.error("Error in handleSend:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Cpu className="text-emerald-500 w-12 h-12" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E6E6E6] font-sans text-[#141414] p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 h-[90vh]">
        
        {/* --- Left Panel: Memory & Stats --- */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#151619] rounded-2xl p-6 text-white flex flex-col gap-4 shadow-2xl border border-white/10"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="text-emerald-400 w-5 h-5" />
                <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-400">Neural Core</h2>
              </div>
              <Activity className="text-emerald-400/30 w-4 h-4" />
            </div>

            {!user ? (
              <div className="flex flex-col gap-4 items-center justify-center py-12 text-center">
                <p className="text-sm text-gray-400">Authentication required to access memory banks.</p>
                <button 
                  onClick={signIn}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-2 rounded-full font-bold transition-all"
                >
                  <LogIn size={18} />
                  Initialize
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-mono uppercase text-gray-500 block mb-1">Active Identity</label>
                    <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold">
                        {user.displayName?.[0] || 'U'}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{user.displayName}</p>
                        <p className="text-[10px] text-gray-500 font-mono">{user.email}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase text-gray-500 block mb-1">Learned Habits</label>
                    <div className="flex flex-wrap gap-2">
                      {profile?.habits.length ? profile.habits.map((h, i) => (
                        <span key={i} className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20">
                          {h}
                        </span>
                      )) : <span className="text-[10px] text-gray-600 italic">No habits detected yet...</span>}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase text-gray-500 block mb-1">Preferences</label>
                    <div className="text-[11px] text-gray-300 font-mono bg-black/40 p-3 rounded-xl border border-white/5 max-h-32 overflow-y-auto">
                      {profile?.preferences && Object.keys(profile.preferences).length > 0 ? (
                        <pre className="whitespace-pre-wrap">{JSON.stringify(profile.preferences, null, 2)}</pre>
                      ) : "Awaiting data patterns..."}
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-white/5 flex justify-between items-center">
                  <button onClick={signOut} className="text-gray-500 hover:text-red-400 transition-colors">
                    <LogOut size={18} />
                  </button>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-500/50">
                    <Zap size={12} />
                    HYDRA v1.0.4
                  </div>
                </div>
              </>
            )}
          </motion.div>

          {/* System Status */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-xl border border-gray-200 flex flex-col gap-4"
          >
            <div className="flex items-center gap-2">
              <Settings className="text-gray-400 w-4 h-4" />
              <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-500">System Diagnostics</h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Voice Sensors</span>
                <span className="text-[10px] font-mono text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">ONLINE</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Memory Banks</span>
                <span className="text-[10px] font-mono text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">CONNECTED</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Neural Latency</span>
                <span className="text-[10px] font-mono text-gray-500">14ms</span>
              </div>
            </div>
          </motion.div>

          {/* Mission Objectives (To-Do List) */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-6 shadow-xl border border-gray-200 flex flex-col gap-4 flex-1 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListTodo className="text-gray-400 w-4 h-4" />
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Mission Objectives</h2>
              </div>
              <span className="text-[10px] font-mono text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">
                {tasks.filter(t => !t.completed).length} ACTIVE
              </span>
            </div>

            {user && (
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask()}
                  placeholder="New objective..."
                  className="flex-1 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500/20 outline-none"
                />
                <button 
                  onClick={addTask}
                  className="bg-[#151619] text-emerald-500 p-2 rounded-lg hover:bg-black transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {tasks.length === 0 ? (
                <div className="py-8 text-center opacity-30">
                  <p className="text-[10px] font-mono uppercase">No objectives logged</p>
                </div>
              ) : (
                tasks.map(task => (
                  <motion.div 
                    key={task.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl group border border-transparent hover:border-emerald-500/10 transition-all"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button 
                        onClick={() => toggleTask(task)}
                        className={`transition-colors ${task.completed ? 'text-emerald-500' : 'text-gray-300 hover:text-emerald-400'}`}
                      >
                        {task.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      <span className={`text-xs truncate ${task.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {task.text}
                      </span>
                    </div>
                    <button 
                      onClick={() => deleteTask(task.id)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </div>

        {/* --- Right Panel: Chat Interface --- */}
        <div className="lg:col-span-8 flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden relative">
          
          {/* Header */}
          <div className="p-4 border-bottom border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-[#151619] flex items-center justify-center">
                  <Cpu className="text-emerald-500 w-6 h-6" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight">HYDRA</h1>
                <p className="text-[10px] font-mono text-gray-400 uppercase tracking-tighter">Advanced Autonomous Agent</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-mono text-gray-400">UPTIME</span>
                <span className="text-[10px] font-mono font-bold">04:22:11:09</span>
              </div>
              <History className="text-gray-300 w-5 h-5 cursor-pointer hover:text-emerald-500 transition-colors" />
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed">
            {!user ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-gray-300">
                  <Database size={40} />
                </div>
                <h3 className="text-lg font-bold text-gray-800">System Standby</h3>
                <p className="text-sm text-gray-500 max-w-xs">Hydra is currently in hibernation. Please initialize the neural link to begin interaction.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-50">
                <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">Awaiting Input Signal</p>
                <div className="w-1 h-8 bg-emerald-500/20 rounded-full animate-pulse"></div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <motion.div 
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] p-4 rounded-2xl shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-emerald-500 text-black rounded-tr-none font-medium' 
                      : 'bg-[#151619] text-white rounded-tl-none border border-white/5'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <div className={`text-[9px] mt-2 font-mono opacity-40 ${msg.role === 'user' ? 'text-black' : 'text-white'}`}>
                      {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
            {isProcessing && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-[#151619] text-white p-4 rounded-2xl rounded-tl-none border border-white/5 flex items-center gap-3">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-500/50 uppercase tracking-widest">Processing</span>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-6 bg-white border-t border-gray-100">
            <div className="relative flex items-center gap-4">
              <button 
                onClick={startListening}
                disabled={!user || isProcessing}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  isListening 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : 'bg-[#151619] text-emerald-500 hover:scale-105'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <div className="flex-1 relative">
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={user ? "Transmit signal to Hydra..." : "Initialize link to chat..."}
                  disabled={!user || isProcessing}
                  className="w-full bg-gray-100 border-none rounded-2xl py-3.5 px-5 text-sm focus:ring-2 focus:ring-emerald-500/20 transition-all disabled:opacity-50"
                />
                <button 
                  onClick={() => handleSend()}
                  disabled={!user || isProcessing || !input.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-emerald-500 text-black rounded-xl flex items-center justify-center hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-red-500 animate-ping' : 'bg-gray-300'}`}></div>
                  <span className="text-[9px] font-mono text-gray-400 uppercase">Acoustic Input</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isProcessing ? 'bg-emerald-500 animate-ping' : 'bg-gray-300'}`}></div>
                  <span className="text-[9px] font-mono text-gray-400 uppercase">Neural Processing</span>
                </div>
              </div>
            </div>
          </div>

          {/* Decorative Elements */}
          <div className="absolute top-0 right-0 p-1">
            <div className="w-1 h-1 bg-emerald-500 rounded-full"></div>
          </div>
          <div className="absolute bottom-0 left-0 p-1">
            <div className="w-1 h-1 bg-emerald-500 rounded-full"></div>
          </div>
        </div>

      </div>
    </div>
  );
}
