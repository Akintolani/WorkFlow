import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, Circle, Trash2, Clock, 
  AlertCircle, Cloud, CloudOff, Plus, AlertTriangle, Sparkles, Wand2, Sun, Moon, Workflow, Play, Archive, ChevronDown, ChevronUp, LogOut, Mail, Lock, Search, BarChart3, Calendar,
  Pause, RotateCcw, ShieldAlert, Activity, GitBranch, Target, TrendingUp, TrendingDown, CheckSquare, ListChecks, Volume2, BrainCircuit, ArrowRight, ArrowLeft
} from 'lucide-react';

// Firebase Imports
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, User
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, deleteDoc, updateDoc, 
  onSnapshot, query 
} from 'firebase/firestore';

// --- Task Type Interface ---
interface Task {
  id: string;
  title: string;
  deadline: string; 
  isImportant: boolean;
  quadrant: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
}

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyAB9kNgAo-u" + "Ko731h4VsKo1Flg6PlC7rxc",
  authDomain: "matrixflow-b7153.firebaseapp.com",
  projectId: "matrixflow-b7153",
  storageBucket: "matrixflow-b7153.firebasestorage.app",
  messagingSenderId: "407509617388",
  appId: "1:407509617388:web:9952d5562090c13ae833c9",
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// Utilizing secure dynamic app ID routing required by Firebase Rules
const appId = typeof window !== "undefined" && (window as any).__app_id ? (window as any).__app_id : "default-app-id";

// --- Gemini API Helper ---
const apiKey = "AQ.Ab8RN6LgpSptaA" + "EIApT75yFCKwSKhCP" + "zXsF1GhDtjRvn-HS6Rw";

const callGeminiWithRetry = async (prompt: string, systemInstruction: string, jsonSchema: any = null): Promise<any> => {
  const models = ["gemini-1.5-flash", "gemini-2.5-flash-preview-09-2025", "gemini-2.5-flash"];
  const delays = [1000, 2000, 4000, 8000, 16000];
  
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload: any = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
    };
    if (jsonSchema) {
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: jsonSchema
      };
    }
    
    try {
      const res = await fetch(url, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return jsonSchema ? JSON.parse(text) : text;
      }
    } catch (err) {
      console.warn(`Failed to connect using ${model}. Trying alternative...`, err);
    }
  }
  
  const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const fallbackPayload: any = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
  };
  if (jsonSchema) fallbackPayload.generationConfig = { responseMimeType: "application/json", responseSchema: jsonSchema };

  for (let i = 0; i < delays.length; i++) {
    try {
      const res = await fetch(fallbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fallbackPayload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No text returned");
      return jsonSchema ? JSON.parse(text) : text;
    } catch (err) {
      if (i === delays.length - 1) throw err;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

// --- Alarm Helper ---
const playAlarmFor30Seconds = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    for (let i = 0; i < 30; i++) {
      const time1 = ctx.currentTime + i;
      const time2 = ctx.currentTime + i + 0.2;
      const playBeep = (t: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(850, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
      };
      playBeep(time1);
      playBeep(time2);
    }
  } catch(e) {
    console.error("Audio API error", e);
  }
};

// --- Desktop Notification Helper (Suppresses Mobile) ---
const triggerDesktopNotification = (title: string, body: string) => {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
  if (!isMobile && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, requireInteraction: true }); 
  }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [nudgeMessage, setNudgeMessage] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Auth Forms
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isSignUp, setIsSignUp] = useState<boolean>(false);

  // Inputs
  const [inputMode, setInputMode] = useState<string>('manual'); 
  const [title, setTitle] = useState<string>('');
  const [deadline, setDeadline] = useState<string>('');
  const [isImportant, setIsImportant] = useState<boolean>(false);
  const [brainDumpText, setBrainDumpText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState<boolean>(false);

  // AI & Advanced Features
  const [isAskingNext, setIsAskingNext] = useState<boolean>(false);
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [archiveSearch, setArchiveSearch] = useState<string>('');
  const [archiveDate, setArchiveDate] = useState<string>('');
  const [showAnalyticsModal, setShowAnalyticsModal] = useState<boolean>(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [aiAnalyticsReport, setAiAnalyticsReport] = useState<string | null>(null);
  
  // Pomodoro
  const [activeFocusTask, setActiveFocusTask] = useState<Task | null>(null);
  const [focusTimeLeft, setFocusTimeLeft] = useState<number>(25 * 60);
  const [isFocusActive, setIsFocusActive] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<'work' | 'break'>('work');

  // Manual Triage & Decomposition
  const [showTriageModal, setShowTriageModal] = useState<boolean>(false);
  const [manualTriageSelections, setManualTriageSelections] = useState<Record<string, string>>({});
  const [isDecomposingId, setIsDecomposingId] = useState<string | null>(null);

  // Assistant Voice State
  const [assistantVoice, setAssistantVoice] = useState<string>('susan');
  const [showLandingPage, setShowLandingPage] = useState<boolean>(true);
  const [prefsLoaded, setPrefsLoaded] = useState<boolean>(false);

  const notifiedTasksRef = useRef<Set<string>>(new Set());
  const hasAnnouncedOverloadRef = useRef<boolean>(false);
  const hasWelcomedRef = useRef<boolean>(false);

  // Guest detection: ensures the user has permanently signed in with an email/Google
  const isGuest = !user || user.isAnonymous;

  const showToast = (message: string, type: string = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // --- Preference Synchronization Handlers ---
  const handleToggleTheme = async () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (!isGuest && user) {
      try {
        const prefRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'preferences');
        await setDoc(prefRef, { isDarkMode: newMode }, { merge: true });
      } catch (e) {
        console.error("Failed to sync theme", e);
      }
    }
  };

  const handleChangeVoice = async (newVoice: string) => {
    setAssistantVoice(newVoice);
    if (!isGuest && user) {
      try {
        const prefRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'preferences');
        await setDoc(prefRef, { assistantVoice: newVoice }, { merge: true });
      } catch (e) {
        console.error("Failed to sync voice", e);
      }
    }
  };

  // Fetch Settings on Login
  useEffect(() => {
    if (isGuest || !user) {
      setPrefsLoaded(true);
      return;
    }
    const prefRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'preferences');
    const unsubscribe = onSnapshot(prefRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.isDarkMode !== undefined) setIsDarkMode(data.isDarkMode);
        if (data.assistantVoice !== undefined) setAssistantVoice(data.assistantVoice);
      }
      setPrefsLoaded(true);
    }, (error) => {
      console.error("Failed to fetch preferences:", error);
      setPrefsLoaded(true);
    });
    return () => unsubscribe();
  }, [user, isGuest]);

  // --- Speech Synthesis Router ---
  const speakAnnouncement = (text: string, voiceAlias: string, onEndCallback?: () => void) => {
    if (!('speechSynthesis' in window)) {
      if (onEndCallback) onEndCallback();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (onEndCallback) {
      utterance.onend = onEndCallback;
      utterance.onerror = onEndCallback;
    }

    const voices = window.speechSynthesis.getVoices();
    const enVoices = voices.filter(v => v.lang.startsWith('en'));
    
    if (enVoices.length > 0) {
      let selectedVoice;
      if (voiceAlias === 'susan') {
        selectedVoice = enVoices.find(v => v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Female')) || enVoices[0];
      } else if (voiceAlias === 'mike') {
        selectedVoice = enVoices.find(v => v.name.includes('Daniel') || v.name.includes('David') || v.name.includes('Male')) || enVoices[1 % enVoices.length];
      } else if (voiceAlias === 'emma') {
        selectedVoice = enVoices.find(v => v.name.includes('Victoria') || v.name.includes('Karen') || (v.lang === 'en-GB' && v.name.includes('Female'))) || enVoices[2 % enVoices.length];
      } else if (voiceAlias === 'jason') {
        selectedVoice = enVoices.find(v => v.name.includes('Arthur') || v.name.includes('Mark') || (v.lang === 'en-US' && v.name.includes('Male'))) || enVoices[3 % enVoices.length];
      } else if (voiceAlias === 'davis') {
        selectedVoice = enVoices.find(v => v.name.includes('Thomas') || v.name.includes('Evan') || v.name.includes('Fred') || (v.lang === 'en-US' && v.name.includes('Male'))) || enVoices[4 % enVoices.length];
      } else if (voiceAlias === 'raymond') {
        selectedVoice = enVoices.find(v => v.name.includes('Oliver') || v.name.includes('Nathan') || v.name.includes('Gordon') || (v.lang === 'en-GB' && v.name.includes('Male'))) || enVoices[5 % enVoices.length];
      }
      if (selectedVoice) utterance.voice = selectedVoice;
    }
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // Trigger Welcome Voice Once Per Session
  useEffect(() => {
    if (!isGuest && !isAuthLoading && prefsLoaded && !hasWelcomedRef.current && !showLandingPage) {
      hasWelcomedRef.current = true;
      setTimeout(() => {
        const name = assistantVoice.charAt(0).toUpperCase() + assistantVoice.slice(1);
        speakAnnouncement(`Welcome to work flow, Your work assistant, I am ${name} and I will be your personal assistant.`, assistantVoice);
      }, 1500);
    }
  }, [isGuest, isAuthLoading, showLandingPage, assistantVoice, prefsLoaded]);

  // --- Core Firebase Auth Initialization (Bulletproofed for Vercel) ---
  useEffect(() => {
    document.title = "Work Flow";
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='6' height='6' rx='1'></rect><rect x='15' y='15' width='6' height='6' rx='1'></rect><path d='M9 6h4a2 2 0 0 1 2 2v6'></path></svg>";

    const script = document.createElement('script');
    script.src = 'https://cdn.tailwindcss.com';
    document.head.appendChild(script);

    if ('Notification' in window) {
      Notification.requestPermission().then(setNotificationPermission);
    }

    let isMounted = true;
    const isCanvasEnv = typeof window !== 'undefined' && (window as any).__app_id;
    
    const initializeAuth = async () => {
      // 1. Await Firebase's internal restoration of the session from the browser's IndexedDB. 
      // This strictly prevents the app from rendering the login screen if an active session exists.
      await auth.authStateReady(); 
      
      // 2. Only inject a temporary session if the app is strictly inside the Canvas editor 
      // and NO email session was found. On Vercel, this is bypassed.
      if (isCanvasEnv && !auth.currentUser) {
        const initialToken = (window as any).__initial_auth_token;
        if (initialToken) {
          try { await signInWithCustomToken(auth, initialToken); } 
          catch (e) { await signInAnonymously(auth); }
        } else {
          await signInAnonymously(auth);
        }
      }

      // 3. Unblock the loading screen.
      if (isMounted) setIsAuthLoading(false);
    };

    initializeAuth();

    // 4. Standard state listener syncs React state dynamically.
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (isMounted) setUser(currentUser);
    });

    return () => {
      isMounted = false;
      unsubscribe();
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  // Monitor Q1 tasks to automatically announce cognitive overload
  useEffect(() => {
    const q1Count = tasks.filter(t => t.quadrant === 'Q1' && t.status !== 'completed').length;
    if (q1Count >= 4) {
      if (!hasAnnouncedOverloadRef.current && !showLandingPage) {
        speakAnnouncement(`Cognitive Workload Warning. Your Q 1 quadrant contains ${q1Count} tasks. Executive bottleneck warning is active.`, assistantVoice);
        hasAnnouncedOverloadRef.current = true;
      }
    } else {
      hasAnnouncedOverloadRef.current = false;
    }
  }, [tasks, assistantVoice, showLandingPage]);

  // Nudge logic interval
  useEffect(() => {
    const checkNudgesAndEscalations = async () => {
      const now = new Date();
      const nowTime = now.getTime();
      const currentTimeString = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

      tasks.forEach(async (task) => {
        if (task.status === 'completed' || !task.deadline) return;
        
        const taskTime = new Date(task.deadline).getTime();
        const diffMinutes = Math.round((taskTime - nowTime) / (1000 * 60));
        
        if (diffMinutes < 0 && task.quadrant === 'Q2' && !isGuest && user) {
          const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id);
          await updateDoc(taskRef, { quadrant: 'Q1' });
          showToast(`Escalation: "${task.title}" running past timeline; moved to Q1 Crisis`, 'error');
        }

        const targetIntervals = [30, 20, 15, 5, 0];
        if (targetIntervals.includes(diffMinutes)) {
          const nudgeId = `${task.id}-${diffMinutes}`;
          if (!notifiedTasksRef.current.has(nudgeId)) {
            notifiedTasksRef.current.add(nudgeId);
            
            if (diffMinutes === 0) {
              const msgText = `Time's up for task: ${task.title}`;
              setNudgeMessage(msgText);
              setTimeout(() => setNudgeMessage(null), 10000); 

              triggerDesktopNotification('WorkFlow Alert', msgText);
              speakAnnouncement(`It is time for your task: ${task.title}.`, assistantVoice, playAlarmFor30Seconds);
            } else {
              const msgText = `Upcoming in ${diffMinutes} mins: ${task.title}`;
              setNudgeMessage(msgText);
              setTimeout(() => setNudgeMessage(null), 10000); 

              triggerDesktopNotification('WorkFlow Alert', msgText);
              speakAnnouncement(`The time is ${currentTimeString}, you have ${task.title} in ${diffMinutes} minutes.`, assistantVoice);
            }
          }
        }
      });
    };
    const intervalId = setInterval(checkNudgesAndEscalations, 30000);
    checkNudgesAndEscalations(); 
    return () => clearInterval(intervalId);
  }, [tasks, assistantVoice, isGuest, user]);

  useEffect(() => {
    let interval: any = null;
    if (isFocusActive && focusTimeLeft > 0) {
      interval = setInterval(() => setFocusTimeLeft(prev => prev - 1), 1000);
    } else if (focusTimeLeft === 0 && isFocusActive) {
      setIsFocusActive(false);
      if (focusMode === 'work') {
        showToast("Focus session complete! Time to take a short break.", "success");
        setFocusMode('break');
        setFocusTimeLeft(5 * 60);
        speakAnnouncement("Focus session complete. Time to take a short break!", assistantVoice);
      } else {
        showToast("Break complete! Ready to focus again?", "success");
        setFocusMode('work');
        setFocusTimeLeft(25 * 60);
        speakAnnouncement("Break complete. Time to focus again!", assistantVoice);
      }
    }
    return () => clearInterval(interval);
  }, [isFocusActive, focusTimeLeft, focusMode, assistantVoice]);

  const handleGoogleAuth = async () => {
    try { setAuthError(''); await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (e: any) { setAuthError(e.message.replace('Firebase: ', '')); }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAuthError('');
      if (isSignUp) await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      else await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (e: any) { setAuthError(e.message.replace('Firebase: ', '')); }
  };

  const handleSignOut = async () => {
    hasWelcomedRef.current = false;
    setAuthEmail('');
    setAuthPassword('');
    try {
      await signOut(auth);
      setShowLandingPage(true);
    } catch (e) {
      console.error("Sign Out Error:", e);
    }
  };

  // Data Fetching Sync
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (isGuest || !user) return;
    setSyncing(true);
    
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'));

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];
        tasksData.sort((a, b) => {
          const aTime = a.deadline ? new Date(a.deadline).getTime() : 9999999999999;
          const bTime = b.deadline ? new Date(b.deadline).getTime() : 9999999999999;
          return aTime - bTime;
        });
        setTasks(tasksData);
        setSyncing(false);
      },
      (error) => { console.error("Sync Error:", error); setSyncing(false); }
    );

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [isGuest, user]);

  const calculateQuadrant = (taskDeadline: string, taskIsImportant: boolean): string => {
    let isUrgent = false;
    if (taskDeadline) {
      const diffHours = (new Date(taskDeadline).getTime() - new Date().getTime()) / (1000 * 60 * 60);
      isUrgent = diffHours <= 24; 
    }
    if (isUrgent && taskIsImportant) return 'Q1'; 
    if (!isUrgent && taskIsImportant) return 'Q2'; 
    if (isUrgent && !taskIsImportant) return 'Q3'; 
    return 'Q4'; 
  };

  const saveTaskToDb = async (taskData: { title: string; deadline: string; isImportant: boolean }) => {
    if (isGuest || !user) return;
    const taskRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'));
    await setDoc(taskRef, {
      id: taskRef.id,
      ...taskData,
      quadrant: calculateQuadrant(taskData.deadline, taskData.isImportant),
      status: 'pending',
      createdAt: new Date().toISOString()
    });
  };

  const handleManualAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || isGuest || !user) return;
    const taskData = { title, deadline, isImportant };
    setTitle(''); setDeadline(''); setIsImportant(false);

    try {
      await saveTaskToDb(taskData);
      showToast('Task successfully added');
    } catch (error) { 
      showToast('Failed to save task. Please check your connection.', 'error'); 
    }
  };

  const toggleTaskStatus = async (task: Task) => {
    if (isGuest || !user) return;
    const isNowCompleted = task.status !== 'completed';
    await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id), { 
      status: isNowCompleted ? 'completed' : 'pending',
      completedAt: isNowCompleted ? new Date().toISOString() : null
    });
    showToast(isNowCompleted ? 'Task completed!' : 'Task moved back to pending', isNowCompleted ? 'success' : 'info');
  };

  const handleDeleteTask = async (taskId: string) => {
    if (isGuest || !user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId));
    showToast('Task removed', 'info');
  };

  const updateTaskQuadrant = async (task: Task, newQuadrant: string) => {
    if (isGuest || !user || task.quadrant === newQuadrant) return;
    await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id), { quadrant: newQuadrant });
    showToast(`Task moved to ${newQuadrant}`, 'success');
  };

  const handleTaskDecomposition = async (task: Task) => {
    if (isGuest || !user) return;
    setIsDecomposingId(task.id);
    try {
      const deadlineContext = task.deadline ? `The final deadline for this task is ${new Date(task.deadline).toISOString()}. Calculate a logical deadline for each micro-task that occurs strictly BEFORE the final deadline.` : `There is no strict deadline for this task. Set the micro-tasks deadline fields to an empty string ''.`;
      const prompt = `The user has a broad or overwhelming task: "${task.title}". ${deadlineContext} Break this complex task down into 3 highly actionable, smaller sequential micro-tasks.`;
      const systemInstruction = `You are a project management AI. Return a JSON object with a 'subtasks' array. Each item must have 'title' (string, starting with an action verb) and 'deadline' (string, ISO 8601 format, or empty string ''), and 'isImportant' matching the parent's importance (${task.isImportant}).`;
      
      const schema = {
        type: "OBJECT",
        properties: {
          subtasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                deadline: { type: "STRING" },
                isImportant: { type: "BOOLEAN" }
              },
              required: ["title", "deadline", "isImportant"]
            }
          }
        }
      };

      const result = await callGeminiWithRetry(prompt, systemInstruction, schema);
      
      if (result && result.subtasks && result.subtasks.length > 0) {
        for (const sub of result.subtasks) {
          await saveTaskToDb({ title: `[Step] ${sub.title}`, deadline: sub.deadline ? sub.deadline.slice(0, 16) : '', isImportant: task.isImportant });
        }
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id));
        showToast(`Task successfully decomposed into ${result.subtasks.length} actionable steps.`, 'success');
      } else {
        showToast('AI could not decompose this task further.', 'info');
      }
    } catch (e) {
      console.error("Decomposition failed", e);
      showToast('Failed to decompose task via AI.', 'error');
    }
    setIsDecomposingId(null);
  };

  const getWeeklyStats = () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const daysMap: Record<string, number> = {};
    for(let i = 0; i < 7; i++) {
       const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
       daysMap[d.toLocaleDateString('en-US', { weekday: 'long' })] = 0;
    }

    let createdCount = 0;
    let completedCount = 0;

    tasks.forEach(t => {
       const createdDate = new Date(t.createdAt);
       if (createdDate >= oneWeekAgo) createdCount++;
       if (t.status === 'completed') {
          const compDateStr = t.completedAt || (t.deadline ? t.deadline : null) || t.createdAt;
          if (compDateStr) {
            const compDate = new Date(compDateStr);
            if (compDate >= oneWeekAgo && compDate <= now) {
               completedCount++;
               const dayName = compDate.toLocaleDateString('en-US', { weekday: 'long' });
               if (daysMap[dayName] !== undefined) {
                  daysMap[dayName]++;
               }
            }
          }
       }
    });

    let mostProdDay = "None";
    let leastProdDay = "None";
    let max = -1;
    let min = 999999;

    Object.entries(daysMap).forEach(([day, count]) => {
       if (count > max) { max = count; mostProdDay = count > 0 ? day : "None"; }
       if (count < min) { min = count; leastProdDay = day; }
    });

    return { 
      createdCount, 
      completedCount, 
      rate: createdCount > 0 ? Math.round((completedCount/createdCount)*100) : 0, 
      mostProdDay, 
      leastProdDay 
    };
  };

  const handleGenerateWeeklyReport = async () => {
    setIsGeneratingReport(true);
    setAiAnalyticsReport(null);
    try {
      const stats = getWeeklyStats();
      const prompt = `Database metrics for past 7 days: Tasks Created: ${stats.createdCount}, Completed: ${stats.completedCount}. Most Productive Day: ${stats.mostProdDay}. Least Productive Day: ${stats.leastProdDay}.`;
      const systemInstruction = `You are an elite corporate productivity consultant. Analyze the quantitative matrix variables provided. Give a dense, highly specialized two-sentence strategic diagnostic outlining focus constraints and an immediate workload balance recommendation based on the Eisenhower method.`;
      const analysisResult = await callGeminiWithRetry(prompt, systemInstruction);
      setAiAnalyticsReport(analysisResult);
      speakAnnouncement(analysisResult, assistantVoice);
    } catch (e) {
      const errMsg = "System experienced an optimization timeout. Please check your data connectivity infrastructure.";
      setAiAnalyticsReport(errMsg);
      speakAnnouncement(errMsg, assistantVoice);
    }
    setIsGeneratingReport(false);
  };

  const handleOpenAnalytics = () => {
    setShowAnalyticsModal(true);
    const stats = getWeeklyStats();
    const announcement = `Weekly Performance Report. Your hard data analytics covering the past 7 days of executive task execution. Created, ${stats.createdCount}. Completed, ${stats.completedCount}. Best Day, ${stats.mostProdDay}. Worst Day, ${stats.leastProdDay}.`;
    speakAnnouncement(announcement, assistantVoice);
  };

  const handleOpenTriage = () => {
    setManualTriageSelections({});
    setShowTriageModal(true);
    const q1Count = tasks.filter(t => t.quadrant === 'Q1' && t.status !== 'completed').length;
    speakAnnouncement(`Opening Workload Triage. Please manually review and defer non-critical tasks to protect your focus and balance your workload.`, assistantVoice);
  };

  const applyManualTriage = async () => {
    if (isGuest || !user) return;
    try {
      let updatedCount = 0;
      for (const [taskId, newQuad] of Object.entries(manualTriageSelections)) {
        const task = tasks.find(t => t.id === taskId);
        if (task && task.quadrant !== newQuad) {
          await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId), { quadrant: newQuad });
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        showToast(`Successfully moved ${updatedCount} tasks.`, "success");
      } else {
        showToast("No changes made.", "info");
      }
      setShowTriageModal(false);
      setManualTriageSelections({});
    } catch (e) {
      showToast("Failed to apply triage modifications", "error");
    }
  };

  const handleBrainDump = async () => {
    if (!brainDumpText.trim()) return;
    setIsExtracting(true);
    try {
      const prompt = `Extract all actionable tasks from this paragraph: "${brainDumpText}"`;
      const systemInstruction = `You are a data extraction assistant. Current time: ${new Date().toISOString()}. Extract tasks. Return JSON array of objects: title(string), deadline(ISO 8601 string, leave empty string "" if no timeline is specified or implied), isImportant(boolean).`;
      const schema = { type: "OBJECT", properties: { tasks: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, deadline: { type: "STRING" }, isImportant: { type: "BOOLEAN" } }, required: ["title", "deadline", "isImportant"] } } } };

      const result = await callGeminiWithRetry(prompt, systemInstruction, schema);
      if (result && result.tasks && result.tasks.length > 0) {
        for (const t of result.tasks) await saveTaskToDb({ title: t.title, deadline: t.deadline ? t.deadline.slice(0, 16) : '', isImportant: t.isImportant });
        showToast(`Successfully extracted ${result.tasks.length} tasks`);
        setBrainDumpText(''); setInputMode('manual'); 
      } else showToast('No tasks found in text', 'info');
    } catch (e) { showToast("Failed to extract tasks. Check connection.", "error"); }
    setIsExtracting(false);
  };

  const handleWhatNext = async () => {
    setIsAskingNext(true);
    try {
      const pendingTasks = tasks.filter(t => t.status !== 'completed').map(t => ({ title: t.title, deadline: t.deadline, quadrant: t.quadrant }));
      if (pendingTasks.length === 0) { 
        const msg = "You have no pending tasks. Enjoy your free time.";
        setAiRecommendation(msg); 
        speakAnnouncement(msg, assistantVoice);
        setIsAskingNext(false); 
        return; 
      }
      const prompt = `My pending tasks: ${JSON.stringify(pendingTasks)}`;
      const sys = `You are an Executive Assistant. Based on Eisenhower matrix quadrants and deadlines provided, identify the single most critical task to focus on RIGHT NOW. Provide a brief 1-2 sentence recommendation.`;
      const result = await callGeminiWithRetry(prompt, sys);
      setAiRecommendation(result);
      speakAnnouncement(result, assistantVoice);
    } catch (e) { 
      const msg = "Unable to reach the AI assistant. Please check your connection.";
      setAiRecommendation(msg); 
      speakAnnouncement(msg, assistantVoice);
    }
    setIsAskingNext(false);
  };

  const filteredCompletedTasks = tasks.filter(t => {
    if (t.status !== 'completed') return false;
    const matchesSearch = t.title.toLowerCase().includes(archiveSearch.toLowerCase());
    const matchesDate = !archiveDate ? true : t.deadline.startsWith(archiveDate);
    return matchesSearch && matchesDate;
  }).sort((a, b) => {
    const aTime = a.deadline ? new Date(a.deadline).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.deadline ? new Date(b.deadline).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  const groupedTasks = {
    Q1: tasks.filter(t => t.quadrant === 'Q1' && t.status !== 'completed'),
    Q2: tasks.filter(t => t.quadrant === 'Q2' && t.status !== 'completed'),
    Q3: tasks.filter(t => t.quadrant === 'Q3' && t.status !== 'completed'),
    Q4: tasks.filter(t => t.quadrant === 'Q4' && t.status !== 'completed'),
  };

  const theme = {
    appBg: isDarkMode ? 'bg-slate-900 text-slate-100' : 'bg-slate-200 text-slate-900',
    header: isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-slate-200/80 border-slate-300',
    card: isDarkMode ? 'bg-slate-800/50 border-slate-700 shadow-lg' : 'bg-slate-50 border-slate-300 shadow-sm',
    input: isDarkMode ? 'bg-slate-900/50 border-slate-700 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400',
    textMuted: isDarkMode ? 'text-slate-400' : 'text-slate-600',
    textMain: isDarkMode ? 'text-slate-100' : 'text-slate-900',
    q1: isDarkMode ? 'border-red-900/50 bg-red-950/20' : 'border-red-300 bg-red-100/50',
    q2: isDarkMode ? 'border-blue-900/50 bg-blue-950/20' : 'border-blue-300 bg-blue-100/50',
    q3: isDarkMode ? 'border-amber-900/50 bg-amber-950/20' : 'border-amber-300 bg-amber-100/50',
    q4: isDarkMode ? 'border-slate-800 bg-slate-800/30' : 'border-slate-300 bg-slate-200/50',
    taskPending: isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700' : 'bg-white hover:bg-slate-100 border-slate-200 shadow-sm',
    taskCompleted: isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-200 border-slate-300',
  };

  const TaskItem = ({ task }: { task: Task }) => {
    const isOverdue = task.deadline && new Date(task.deadline).getTime() < new Date().getTime() && task.status !== 'completed';
    return (
      <div className={`flex flex-col p-4 mb-3 rounded-lg border transition-all duration-200 ${
        task.status === 'completed' ? `opacity-50 ${theme.taskCompleted}` : `${theme.taskPending}`
      } ${isOverdue ? 'ring-2 ring-amber-500/40 border-amber-500/50' : ''}`}>
        <div className="flex items-start justify-between w-full">
          <div className="flex items-start gap-3 sm:gap-4 overflow-hidden w-full">
            <button onClick={() => toggleTaskStatus(task)} className={`mt-1 flex-shrink-0 transition-transform active:scale-75 ${task.status === 'completed' ? 'text-emerald-500' : `${theme.textMuted} hover:text-blue-500`}`}>
              {task.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
            </button>
            <div className="flex flex-col w-full pr-2">
              <span className={`font-medium text-sm block w-full break-words ${task.status === 'completed' ? `line-through opacity-70 ${theme.textMuted}` : theme.textMain}`}>
                {task.title}
              </span>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mt-1.5">
                {task.deadline ? (
                  <span className={`text-xs ${isOverdue ? 'text-amber-500 font-bold' : theme.textMuted} flex items-center gap-1.5 font-medium`}>
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(task.deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {isOverdue && <span className="text-[10px] tracking-wider uppercase px-1.5 py-0.5 bg-amber-500/10 rounded font-black border border-amber-500/20">Overdue</span>}
                  </span>
                ) : task.status === 'completed' && task.completedAt ? (
                  <span className={`text-xs ${theme.textMuted} flex items-center gap-1.5 font-medium`}>
                    <CheckCircle2 className="w-3.5 h-3.5 opacity-60" /> 
                    Done: {new Date(task.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                ) : (
                  <span className={`text-xs ${theme.textMuted} flex items-center gap-1.5 font-medium`}>
                    <Clock className="w-3.5 h-3.5 opacity-50" /> No timeline
                  </span>
                )}
                
                {task.status !== 'completed' && (
                  <select
                    value={task.quadrant}
                    onChange={(e) => updateTaskQuadrant(task, e.target.value)}
                    className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 outline-none cursor-pointer border transition-colors ${isDarkMode ? 'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                  >
                    <option value="Q1">Q1 (Do First)</option>
                    <option value="Q2">Q2 (Schedule)</option>
                    <option value="Q3">Q3 (Delegate)</option>
                    <option value="Q4">Q4 (Delete)</option>
                  </select>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {task.status !== 'completed' && (
              <button onClick={() => handleTaskDecomposition(task)} disabled={isDecomposingId === task.id} className={`p-2 rounded-md transition-colors ${isDecomposingId === task.id ? 'text-blue-500 animate-pulse' : `${theme.textMuted} hover:text-blue-500`}`} title="AI Auto-Breakdown (Decompose Task)">
                {isDecomposingId === task.id ? <Wand2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
              </button>
            )}
            {task.status !== 'completed' && (
              <button onClick={() => { setActiveFocusTask(task); setFocusTimeLeft(25 * 60); setFocusMode('work'); setIsFocusActive(true); showToast(`Focus initiated on: ${task.title}`, 'success'); }} className={`p-2 rounded-md transition-colors ${activeFocusTask?.id === task.id ? 'text-purple-500 bg-purple-500/10' : `${theme.textMuted} hover:text-purple-500`}`} title="Initiate Focus Tracking">
                <Activity className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => handleDeleteTask(task.id)} className={`${theme.textMuted} hover:text-red-500 p-2 rounded-md transition-colors`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isAuthLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center transition-colors duration-300 font-sans ${theme.appBg}`}>
        <Wand2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // --- Authentication / Landing Logic ---
  if (isGuest) {
    if (showLandingPage) {
      return (
        <div className={`min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 transition-colors duration-300 font-sans ${theme.appBg}`}>
          <div className={`w-full max-w-5xl p-6 sm:p-12 rounded-3xl border shadow-2xl flex flex-col items-center text-center ${theme.card}`}>
            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mb-6 border border-blue-500/20">
              <Workflow className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className={`text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 ${theme.textMain}`}>
              Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600">WorkFlow</span>
            </h1>
            <p className={`text-base sm:text-lg max-w-2xl mb-12 leading-relaxed ${theme.textMuted}`}>
              An advanced work assistant system designed to eliminate cognitive overload. Sort your tasks using the Eisenhower Matrix, proactively balance your schedule with Workload Triage, and track your performance with deep analytics.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-12 text-left">
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
                  <ListChecks className="w-6 h-6 text-blue-500" />
                </div>
                <h3 className={`text-lg font-bold mb-2 ${theme.textMain}`}>Task Sorting</h3>
                <p className={`text-sm ${theme.textMuted}`}>Dynamically categorizes your to-dos into the Eisenhower Matrix based on urgency and importance variables.</p>
              </div>
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                  <BrainCircuit className="w-6 h-6 text-purple-500" />
                </div>
                <h3 className={`text-lg font-bold mb-2 ${theme.textMain}`}>Workload Triage</h3>
                <p className={`text-sm ${theme.textMuted}`}>Automatically detects executive bottlenecks and alerts you to manually defer non-critical tasks.</p>
              </div>
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-emerald-500" />
                </div>
                <h3 className={`text-lg font-bold mb-2 ${theme.textMain}`}>Weekly Analytics Report</h3>
                <p className={`text-sm ${theme.textMuted}`}>Generates a deep diagnostic report of your past 7 days to evaluate your executive task execution.</p>
              </div>
            </div>

            <button 
              onClick={() => setShowLandingPage(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg px-8 sm:px-12 py-4 rounded-full transition-all transform hover:scale-105 shadow-lg flex items-center gap-3"
            >
              Enter Workspace <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          
          <div className="mt-8 flex items-center gap-4">
            <button onClick={handleToggleTheme} className={`p-3 rounded-full transition-all ${isDarkMode ? 'bg-slate-800 text-amber-400 hover:bg-slate-700 shadow-lg border border-slate-700' : 'bg-white text-indigo-600 hover:bg-slate-50 shadow-lg border border-slate-200'}`} title="Toggle Theme">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 transition-colors duration-300 font-sans ${theme.appBg}`}>
        <div className="w-full max-w-md mb-4 flex justify-start">
          <button 
            onClick={() => setShowLandingPage(true)}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${theme.textMuted} hover:${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
        </div>
        <div className={`w-full max-w-md p-6 sm:p-8 rounded-2xl border ${theme.card}`}>
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-4">
              <Workflow className="w-8 h-8 text-blue-500" />
            </div>
            <h1 className={`text-2xl font-bold tracking-tight ${theme.textMain}`}>WorkFlow</h1>
            <p className={`text-sm mt-1 text-center font-medium ${theme.textMuted}`}>YourWork Assistant</p>
          </div>

          <button onClick={handleGoogleAuth} className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 px-4 py-3 rounded-xl font-medium transition-colors mb-6 shadow-sm">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fillRule="evenodd" clipRule="evenodd"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fillRule="evenodd" clipRule="evenodd"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fillRule="evenodd" clipRule="evenodd"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fillRule="evenodd" clipRule="evenodd"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>
            <span className={`text-xs uppercase tracking-wider font-medium ${theme.textMuted}`}>Or continue with email</span>
            <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>
          </div>

          <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
            <div className="relative">
              <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
              <input type="email" placeholder="Work Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required className={`w-full pl-10 pr-4 py-3 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm ${theme.input}`} />
            </div>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
              <input type="password" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required className={`w-full pl-10 pr-4 py-3 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm ${theme.input}`} />
            </div>
            {authError && <p className="text-red-500 text-xs text-center font-medium bg-red-500/10 py-2 rounded-lg">{authError}</p>}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors shadow-sm">{isSignUp ? 'Create Account' : 'Sign In'}</button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }} className={`text-sm font-medium hover:underline ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>{isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}</button>
          </div>
        </div>
        <div className="mt-8 flex items-center gap-4">
          <button onClick={handleToggleTheme} className={`p-2 rounded-md transition-all ${isDarkMode ? 'hover:bg-slate-800 text-amber-400' : 'hover:bg-slate-300 text-indigo-600'}`} title="Toggle Theme">{isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
        </div>
      </div>
    );
  }

  // --- Main Application UI ---
  const weeklyStats = getWeeklyStats();

  return (
    <div className={`min-h-screen transition-colors duration-300 font-sans ${theme.appBg}`}>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in border ${toast.type === 'error' ? 'bg-red-600 border-red-500 text-white' : toast.type === 'info' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-emerald-600 border-emerald-500 text-white'}`}>
          {toast.type === 'error' ? <AlertTriangle className="w-5 h-5" /> : toast.type === 'info' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          <span className="font-medium text-sm tracking-wide">{toast.message}</span>
        </div>
      )}

      {nudgeMessage && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 w-[90%] max-w-sm bg-blue-600 text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in border border-blue-500">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium text-sm tracking-wide leading-snug">{nudgeMessage}</span>
        </div>
      )}

      {/* --- BULLETPROOF RESPONSIVE ANALYTICS MODAL --- */}
      {showAnalyticsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
          <div className={`w-full max-w-2xl max-h-[95vh] flex flex-col border p-5 sm:p-6 rounded-2xl shadow-2xl relative overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}>
            <button onClick={() => { setShowAnalyticsModal(false); setAiAnalyticsReport(null); }} className={`absolute top-3 right-3 sm:top-4 sm:right-4 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors z-10 ${isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-200 text-slate-500'}`}>✕ Close</button>
            
            <div className="flex-shrink-0 mb-4 sm:mb-6 pr-10">
              <div className="flex items-center gap-2 mb-1 sm:mb-2">
                <BarChart3 className="w-6 h-6 text-blue-500" />
                <h2 className={`text-lg sm:text-xl font-bold ${theme.textMain}`}>Weekly Performance Report</h2>
              </div>
              <p className={`text-xs sm:text-sm ${theme.textMuted}`}>Your hard data analytics covering the past 7 days of executive task execution.</p>
            </div>
            
            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar pr-1 sm:pr-2 pb-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-5 sm:mb-6">
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                  <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 flex items-center gap-1.5"><Plus className="w-3 h-3"/> Created</p>
                  <p className="text-2xl sm:text-3xl font-black mt-1">{weeklyStats.createdCount}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
                  <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 flex items-center gap-1.5"><CheckSquare className="w-3 h-3"/> Completed</p>
                  <p className="text-2xl sm:text-3xl font-black mt-1">{weeklyStats.completedCount}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-purple-50 border-purple-200 text-purple-600'}`}>
                  <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 flex items-center gap-1.5"><TrendingUp className="w-3 h-3"/> Best Day</p>
                  <p className="text-base sm:text-lg font-black mt-1 leading-tight truncate">{weeklyStats.mostProdDay}</p>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
                  <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 flex items-center gap-1.5"><TrendingDown className="w-3 h-3"/> Worst Day</p>
                  <p className="text-base sm:text-lg font-black mt-1 leading-tight truncate">{weeklyStats.leastProdDay}</p>
                </div>
              </div>

              <button onClick={handleGenerateWeeklyReport} disabled={isGeneratingReport} className={`w-full flex items-center justify-center gap-2 border px-4 py-3 rounded-xl transition-all disabled:opacity-50 text-sm mb-4 font-semibold shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}>
                {isGeneratingReport ? <Wand2 className="w-4 h-4 animate-spin text-blue-500" /> : <Sparkles className="w-4 h-4 text-blue-500" />}
                {isGeneratingReport ? 'Analyzing metrics...' : 'Generate Deep AI Diagnostic'}
              </button>

              {aiAnalyticsReport && (
                <div className={`p-4 sm:p-5 rounded-xl border transition-all duration-300 ${isDarkMode ? 'bg-blue-900/10 border-blue-500/30 text-blue-100' : 'bg-blue-50 border-blue-200 text-blue-900'}`}>
                  <div className="flex items-center gap-1.5 mb-3"><Workflow className="w-4 h-4 text-blue-500" /><span className="text-xs font-bold uppercase tracking-wider text-blue-500">Gemini Strategic Feedback</span></div>
                  <p className="text-xs sm:text-sm font-medium leading-relaxed italic">{aiAnalyticsReport}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- RESPONSIVE MANUAL TRIAGE MODAL --- */}
      {showTriageModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
          <div className={`w-full max-w-xl max-h-[95vh] flex flex-col border p-5 sm:p-6 rounded-2xl shadow-2xl relative overflow-hidden ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}>
            
            <button onClick={() => setShowTriageModal(false)} className={`absolute top-3 right-3 sm:top-4 sm:right-4 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors z-10 ${isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-200 text-slate-500'}`}>✕ Cancel</button>
            
            <div className="flex-shrink-0 mb-4 sm:mb-6 pr-10">
              <div className="flex items-center gap-2 mb-1 sm:mb-2 text-amber-500">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
                <h2 className={`text-lg sm:text-xl font-bold ${theme.textMain}`}>Cognitive Workload Triage</h2>
              </div>
              <p className={`text-xs sm:text-sm ${theme.textMuted}`}>Your "Do First" quadrant is overloaded. Manually review and defer non-critical tasks to protect your focus and balance your workload.</p>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 mb-5 sm:mb-6 pr-1 sm:pr-2 custom-scrollbar space-y-3">
              {groupedTasks.Q1.map((task) => {
                const selectedQuadrant = manualTriageSelections[task.id] || task.quadrant;
                return (
                  <div key={task.id} className={`p-3 sm:p-4 rounded-lg border ${isDarkMode ? 'bg-slate-900/40 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2 mb-2">
                      <span className={`font-bold text-sm leading-tight ${theme.textMain}`}>{task.title}</span>
                      <select
                        value={selectedQuadrant}
                        onChange={(e) => setManualTriageSelections(prev => ({ ...prev, [task.id]: e.target.value }))}
                        className={`text-[10px] sm:text-xs font-semibold uppercase tracking-wider rounded px-2 py-1.5 outline-none cursor-pointer border transition-colors ${
                          isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <option value="Q1">Keep in Q1 (Do First)</option>
                        <option value="Q2">Defer to Q2 (Schedule)</option>
                        <option value="Q3">Move to Q3 (Delegate)</option>
                        <option value="Q4">Move to Q4 (Delete)</option>
                      </select>
                    </div>
                    {task.deadline && (
                      <p className={`text-[10px] sm:text-xs font-medium uppercase tracking-widest opacity-80 ${theme.textMuted}`}>Deadline: {new Date(task.deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex-shrink-0 flex flex-col sm:flex-row gap-3">
              <button onClick={applyManualTriage} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 sm:py-2.5 rounded-xl text-sm transition-colors shadow-sm">Apply Adjustments</button>
            </div>
            
          </div>
        </div>
      )}

      <header className={`${theme.header} backdrop-blur-md sticky top-0 z-20 shadow-sm transition-colors duration-300 border-b`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-col">
            <h1 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${theme.textMain}`}>
              <Workflow className="w-6 h-6 text-blue-500" /> WorkFlow
            </h1>
            <p className={`text-[10px] ${theme.textMuted} font-semibold tracking-widest uppercase mt-0.5`}>Work Assistant</p>
          </div>
          
          <div className="flex items-center gap-3 sm:gap-4 text-sm w-full md:w-auto overflow-x-auto pb-2 md:pb-0 custom-scrollbar">
            <button onClick={handleOpenAnalytics} className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold tracking-wide transition-colors ${isDarkMode ? 'bg-slate-800/40 border-slate-700 text-blue-400 hover:bg-slate-800' : 'bg-white border-slate-300 text-blue-600 hover:bg-slate-50'}`} title="View Weekly Report">
              <BarChart3 className="w-3.5 h-3.5" /> <span>Weekly Analytics</span>
            </button>
            
            {/* Assistant Voice Selector */}
            <div className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-colors ${isDarkMode ? 'bg-slate-800/40 border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-600'}`}>
              <Volume2 className="w-4 h-4" />
              <select 
                value={assistantVoice}
                onChange={(e) => {
                  handleChangeVoice(e.target.value);
                  speakAnnouncement(`Hello, my name is ${e.target.options[e.target.selectedIndex].text}. I am your work assistant.`, e.target.value);
                }}
                className={`bg-transparent text-xs font-semibold tracking-wide outline-none cursor-pointer appearance-none ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}
              >
                <option value="susan">Susan</option>
                <option value="mike">Mike</option>
                <option value="emma">Emma</option>
                <option value="jason">Jason</option>
                <option value="davis">Davis</option>
                <option value="raymond">Raymond</option>
              </select>
            </div>

            <button onClick={handleToggleTheme} className={`flex-shrink-0 p-2 rounded-md transition-all ${isDarkMode ? 'hover:bg-slate-800 text-amber-400' : 'hover:bg-white text-indigo-600 shadow-sm'}`} title="Toggle Theme">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            
            {isOnline ? <span className="flex-shrink-0 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500 text-xs font-semibold tracking-wide"><Cloud className="w-4 h-4" /> <span className="hidden lg:inline">Online</span></span> : <span className="flex-shrink-0 flex items-center gap-1.5 text-amber-600 dark:text-amber-500 text-xs font-semibold tracking-wide"><CloudOff className="w-4 h-4" /> <span className="hidden lg:inline">Offline</span></span>}
            <div className={`flex-shrink-0 w-px h-6 mx-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>
            <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3">
              <span className={`text-xs font-medium hidden md:block truncate max-w-[120px] ${theme.textMuted}`}>{user?.email || 'User'}</span>
              <button onClick={handleSignOut} className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-xs font-medium ${isDarkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100 shadow-sm'}`} title="Sign Out">
                <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 w-full">
        
        <div className={`mb-6 sm:mb-8 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between border p-4 sm:p-5 rounded-xl transition-colors duration-300 ${theme.card}`}>
          <div className="flex-1 w-full">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <h2 className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${theme.textMuted}`}>AI Executive Assistant</h2>
            </div>
            {aiRecommendation ? (
              <p className={`font-medium text-sm md:text-base leading-relaxed ${theme.textMain}`}>{aiRecommendation}</p>
            ) : (
              <p className={`text-xs sm:text-sm ${theme.textMuted}`}>Request an analysis to determine your highest priority task based on the Eisenhower matrix.</p>
            )}
          </div>
          <button onClick={handleWhatNext} disabled={isAskingNext} className={`w-full md:w-auto flex-shrink-0 flex items-center justify-center gap-2 border px-5 py-3 md:py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 text-sm shadow-sm ${isDarkMode ? 'bg-blue-600/20 hover:bg-blue-600/30 border-blue-500/50 text-blue-400' : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700'}`}>
            {isAskingNext ? <Wand2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isAskingNext ? 'Analyzing...' : 'What should I do next?'}
          </button>
        </div>

        <div className={`mb-6 sm:mb-8 border p-4 sm:p-5 rounded-xl transition-colors duration-300 ${theme.card}`}>
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 sm:gap-6">
            <div className="flex-1 w-full">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-purple-500" />
                <h2 className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${theme.textMuted}`}>Flow State Engine (Pomodoro)</h2>
              </div>
              {activeFocusTask ? (
                <div>
                  <p className={`font-semibold text-sm ${theme.textMain} break-words`}>Focusing on: <span className="text-purple-500">{activeFocusTask.title}</span></p>
                  <p className={`text-[10px] sm:text-xs mt-1 uppercase tracking-wider font-extrabold text-purple-400`}>Mode: {focusMode === 'work' ? 'Deep Work Cycle' : 'System Restoration Break'}</p>
                </div>
              ) : (
                <p className={`text-xs sm:text-sm ${theme.textMuted}`}>Select the target focal action icon on any task inside your matrix to launch a structured flow state interval.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full lg:w-auto justify-between lg:justify-end border-t border-slate-200 dark:border-slate-700 lg:border-t-0 pt-4 lg:pt-0 mt-2 lg:mt-0">
              <div className="flex flex-col items-center">
                <span className="font-mono text-4xl sm:text-3xl font-black tracking-widest text-purple-500">
                  {Math.floor(focusTimeLeft / 60).toString().padStart(2, '0')}:{(focusTimeLeft % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
                {activeFocusTask && (
                  <>
                    <button onClick={() => setIsFocusActive(!isFocusActive)} className={`flex-1 sm:flex-none p-3 sm:p-3 flex justify-center rounded-xl text-white transition-all shadow-sm ${isFocusActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-purple-600 hover:bg-purple-700'}`} title={isFocusActive ? "Pause Focus" : "Start Focus"}>{isFocusActive ? <Pause className="w-5 h-5 sm:w-4 sm:h-4" /> : <Play className="w-5 h-5 sm:w-4 sm:h-4" />}</button>
                    <button onClick={() => { setFocusTimeLeft(focusMode === 'work' ? 25 * 60 : 5 * 60); setIsFocusActive(false); }} className={`flex-1 sm:flex-none p-3 sm:p-3 flex justify-center rounded-xl border transition-colors shadow-sm ${isDarkMode ? 'bg-slate-900/50 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`} title="Reset Timer"><RotateCcw className="w-5 h-5 sm:w-4 sm:h-4" /></button>
                    <button onClick={() => { setActiveFocusTask(null); setIsFocusActive(false); setFocusTimeLeft(25 * 60); setFocusMode('work'); }} className={`flex-[2] sm:flex-none px-4 py-3 sm:py-3 rounded-xl text-xs font-bold border transition-colors shadow-sm text-center ${isDarkMode ? 'hover:bg-red-500/10 text-red-400 border-red-500/20' : 'hover:bg-red-50 text-red-600 border-red-200 bg-white'}`}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <section className={`rounded-xl border p-4 sm:p-6 mb-8 sm:mb-10 transition-colors duration-300 ${theme.card}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 sm:mb-6 border-b border-slate-200 dark:border-slate-700 pb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wider flex items-center gap-2 ${theme.textMuted}`}>
              <Plus className="w-4 h-4" /> Add Tasks
            </h2>
            <div className={`flex p-1 rounded-lg w-full sm:w-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <button onClick={() => setInputMode('manual')} className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 text-xs font-medium rounded-md transition-colors ${inputMode === 'manual' ? (isDarkMode ? 'bg-slate-700 text-white' : 'bg-white text-slate-800 shadow-sm') : `${theme.textMuted} hover:text-current`}`}>Manual Input</button>
              <button onClick={() => setInputMode('ai')} className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${inputMode === 'ai' ? (isDarkMode ? 'bg-blue-600/30 text-blue-400' : 'bg-white text-blue-700 shadow-sm') : `${theme.textMuted} hover:text-current`}`}><Sparkles className="w-3 h-3" /> Automatic</button>
            </div>
          </div>

          {inputMode === 'manual' ? (
            <form onSubmit={handleManualAddTask} className="flex flex-col gap-4 w-full overflow-hidden">
              <div className="flex flex-col gap-1.5 w-full">
                <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Task Description</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Finalize the Q3 financial presentation..." className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm ${theme.input}`} required />
              </div>
              
              <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 w-full min-w-0">
                <div className="flex flex-col gap-1.5 w-full sm:flex-1 min-w-0">
                  <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Deadline <span className="opacity-60">(Optional)</span></label>
                  <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={`w-full block max-w-full px-3 sm:px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm transition-all h-[46px] ${theme.input}`} style={{ colorScheme: isDarkMode ? 'dark' : 'light' }} />
                </div>
                <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:min-w-[140px]">
                  <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Priority <span className="opacity-60">(Optional)</span></label>
                  <label className={`flex items-center justify-center gap-2 cursor-pointer border px-4 py-3 rounded-lg transition-colors select-none group h-[46px] w-full ${isDarkMode ? 'bg-slate-900/50 border-slate-700 hover:bg-slate-800' : 'bg-white border-slate-300 hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500" />
                    <span className={`text-sm font-medium ${theme.textMain}`}>High Priority</span>
                  </label>
                </div>
                <button type="submit" disabled={!title} className="w-full sm:w-auto sm:min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm h-[46px] shadow-sm whitespace-nowrap">Add Task</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Task Details (Paragraph)</label>
                <textarea value={brainDumpText} onChange={(e) => setBrainDumpText(e.target.value)} placeholder="Type or paste a paragraph of what you need to do..." className={`w-full h-28 sm:h-24 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm resize-none ${theme.input}`} />
              </div>
              <div className="flex justify-end">
                <button onClick={handleBrainDump} disabled={!brainDumpText.trim() || isExtracting} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 sm:py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-sm">
                  {isExtracting ? <Wand2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />}
                  {isExtracting ? 'Extracting Logic...' : 'Process & Sort'}
                </button>
              </div>
            </div>
          )}
        </section>

        {groupedTasks.Q1.length >= 4 && (
          <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 gap-4 sm:gap-6 animate-fade-in shadow-sm w-full overflow-hidden">
            <div className="flex items-start sm:items-center gap-3 w-full sm:w-auto min-w-0">
              <ShieldAlert className="w-6 h-6 flex-shrink-0 animate-pulse text-red-500 mt-0.5 sm:mt-0" />
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm leading-tight">Cognitive Workload Warning</h4>
                <p className="text-xs opacity-90 mt-1 leading-relaxed">Your Q1 quadrant contains {groupedTasks.Q1.length} tasks. Executive bottleneck warning is active.</p>
              </div>
            </div>
            <button onClick={handleOpenTriage} className="w-full sm:w-auto flex-shrink-0 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium px-5 py-3 sm:py-2.5 rounded-lg text-xs sm:text-sm transition-colors shadow-sm">
              <ListChecks className="w-4 h-4" />
              Review Workload
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          
          <div className={`rounded-xl border p-4 sm:p-5 flex flex-col h-[350px] sm:h-[400px] transition-colors duration-300 ${theme.q1}`}>
            <div className="flex flex-col gap-2 mb-4 border-b border-current pb-3 opacity-80 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-bold text-sm tracking-wide uppercase flex items-center gap-2 truncate ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}><AlertTriangle className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Do First</span></h3>
                <span className={`text-[9px] sm:text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wider flex-shrink-0 whitespace-nowrap ${isDarkMode ? 'bg-red-950/50 text-red-300' : 'bg-red-200 text-red-900 border border-red-300'}`}>Urgent & Important</span>
              </div>
              <p className="text-[10px] sm:text-[11px] leading-relaxed opacity-90 font-medium line-clamp-2">Critical tasks requiring immediate action. Tackle these immediately to prevent crises.</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar min-h-0">
              {groupedTasks.Q1.length === 0 ? <p className={`text-xs text-center mt-10 ${theme.textMuted}`}>No critical tasks.</p> : groupedTasks.Q1.map(task => <TaskItem key={task.id} task={task} />)}
            </div>
          </div>

          <div className={`rounded-xl border p-4 sm:p-5 flex flex-col h-[350px] sm:h-[400px] transition-colors duration-300 ${theme.q2}`}>
            <div className="flex flex-col gap-2 mb-4 border-b border-current pb-3 opacity-80 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-bold text-sm tracking-wide uppercase flex items-center gap-2 truncate ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}><Clock className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Schedule</span></h3>
                <span className={`text-[9px] sm:text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wider flex-shrink-0 whitespace-nowrap ${isDarkMode ? 'bg-blue-950/50 text-blue-300' : 'bg-blue-200 text-blue-900 border border-blue-300'}`}>Important, Not Urgent</span>
              </div>
              <p className="text-[10px] sm:text-[11px] leading-relaxed opacity-90 font-medium line-clamp-2">Strategic goals and long-term planning. Schedule dedicated time to complete these.</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar min-h-0">
              {groupedTasks.Q2.length === 0 ? <p className={`text-xs text-center mt-10 ${theme.textMuted}`}>No strategic tasks planned.</p> : groupedTasks.Q2.map(task => <TaskItem key={task.id} task={task} />)}
            </div>
          </div>

          <div className={`rounded-xl border p-4 sm:p-5 flex flex-col h-[350px] sm:h-[400px] transition-colors duration-300 ${theme.q3}`}>
            <div className="flex flex-col gap-2 mb-4 border-b border-current pb-3 opacity-80 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-bold text-sm tracking-wide uppercase flex items-center gap-2 truncate ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}><AlertCircle className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Delegate</span></h3>
                <span className={`text-[9px] sm:text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wider flex-shrink-0 whitespace-nowrap ${isDarkMode ? 'bg-amber-950/50 text-amber-300' : 'bg-amber-200 text-amber-900 border border-amber-300'}`}>Urgent, Not Important</span>
              </div>
              <p className="text-[10px] sm:text-[11px] leading-relaxed opacity-90 font-medium line-clamp-2">Time-sensitive distractions. Assign these to someone else or automate if possible.</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar min-h-0">
              {groupedTasks.Q3.length === 0 ? <p className={`text-xs text-center mt-10 ${theme.textMuted}`}>No imminent distractions.</p> : groupedTasks.Q3.map(task => <TaskItem key={task.id} task={task} />)}
            </div>
          </div>

          <div className={`rounded-xl border p-4 sm:p-5 flex flex-col h-[350px] sm:h-[400px] transition-colors duration-300 ${theme.q4}`}>
            <div className="flex flex-col gap-2 mb-4 border-b border-current pb-3 opacity-80 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-bold text-sm tracking-wide uppercase flex items-center gap-2 truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}><Trash2 className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Delete</span></h3>
                <span className={`text-[9px] sm:text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wider flex-shrink-0 whitespace-nowrap ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-300 text-slate-800 border border-slate-400'}`}>Not Urgent & Not Important</span>
              </div>
              <p className="text-[10px] sm:text-[11px] leading-relaxed opacity-90 font-medium line-clamp-2">Low-value activities. Remove these entirely to protect your focus and time.</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar min-h-0">
              {groupedTasks.Q4.length === 0 ? <p className={`text-xs text-center mt-10 ${theme.textMuted}`}>Clean slate.</p> : groupedTasks.Q4.map(task => <TaskItem key={task.id} task={task} />)}
            </div>
          </div>

        </div>

        <div className="mt-8">
          <button onClick={() => setShowCompleted(!showCompleted)} className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors duration-300 ${theme.card} hover:opacity-80`}>
            <div className="flex items-center gap-2">
              <Archive className={`w-5 h-5 ${theme.textMuted}`} />
              <h3 className={`font-semibold text-sm ${theme.textMain}`}>Historical Vault Archive ({filteredCompletedTasks.length})</h3>
            </div>
            {showCompleted ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>

          {showCompleted && (
            <div className={`mt-4 p-4 sm:p-5 rounded-xl border transition-colors duration-300 ${theme.card}`}>
              <div className="flex flex-col md:flex-row gap-4 mb-6 border-b border-slate-200 dark:border-slate-700 pb-4">
                <div className="relative flex-1 w-full">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
                  <input type="text" placeholder="Search past logs by title..." value={archiveSearch} onChange={(e) => setArchiveSearch(e.target.value)} className={`w-full pl-10 pr-4 py-3 sm:py-2 rounded-lg border text-xs sm:text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all ${theme.input}`} />
                </div>
                <div className="relative w-full md:w-48">
                  <Calendar className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
                  <input type="date" value={archiveDate} onChange={(e) => setArchiveDate(e.target.value)} className={`w-full pl-10 pr-4 py-3 sm:py-2 rounded-lg border text-xs sm:text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all ${theme.input}`} style={{ colorScheme: isDarkMode ? 'dark' : 'light' }} />
                </div>
              </div>

              {filteredCompletedTasks.length === 0 ? (
                <p className={`text-sm text-center py-4 ${theme.textMuted}`}>No records match your query constraints.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCompletedTasks.map(task => <TaskItem key={task.id} task={task} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(128,128,128,0.3); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(59, 130, 246, 0.8); }
        @keyframes fade-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
}
