import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { 
  ArrowRight, 
  Check, 
  Download, 
  Sparkles, 
  RefreshCw, 
  BookOpen, 
  Users, 
  Target, 
  Layers, 
  FileText,
  Lock,
  CreditCard,
  ShieldCheck,
  Star,
  ExternalLink,
  AlertTriangle
} from "lucide-react";

// --- Types ---
interface ContentData {
  title: string;
  subtitle: string;
  author: string;
  summary: string;
  colorTheme: string;
  chapters: Array<{
    title: string;
    content: string;
    image?: string;
  }>;
}

interface OutlineData {
  title: string;
  subtitle: string;
  author: string;
  summary: string;
  colorTheme: string;
  chapterTitles: string[];
}

interface Answers {
  what: string;
  who: string;
  where: string;
  objective: string;
  level: string;
}

// --- Globals & Constants ---
declare global {
  interface Window {
    jspdf: any;
  }
}

// --- AI Service ---
const generateMaterial = async (answers: Answers, onProgress: (msg: string) => void): Promise<ContentData> => {
  // Inicialização direta usando a variável de ambiente, sem verificações bloqueantes manuais.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Helper: Exponential Backoff Retry Wrapper
  const callWithRetry = async <T,>(
    operationName: string, 
    fn: () => Promise<T>, 
    retries = 3, 
    baseDelay = 4000
  ): Promise<T> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.code === 429 || (error?.message && /quota|limit|429/i.test(error.message));
        
        if (isRateLimit && i < retries - 1) {
          const waitTime = baseDelay * Math.pow(2, i);
          onProgress(`Alta demanda (${operationName}). Aguardando ${waitTime/1000}s...`);
          console.warn(`[${operationName}] Rate limit hit. Waiting ${waitTime}ms`);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }
        console.error(`Error in ${operationName}:`, error);
        throw error;
      }
    }
    throw new Error(`Falha na operação ${operationName} após tentativas.`);
  };

  // STEP 1: Generate Outline & Metadata
  onProgress("Analisando nicho e criando estrutura...");
  
  const outlinePrompt = `
    Você é um editor sênior de livros. Crie a ESTRUTURA para um E-book.
    
    INFORMAÇÕES:
    Tema: ${answers.what}
    Público: ${answers.who}
    Formato: ${answers.where}
    Objetivo: ${answers.objective}
    Nível: ${answers.level}

    REQUISITOS JSON:
    1. Title: Título vendável.
    2. Subtitle: Subtítulo explicativo.
    3. Author: Um nome fictício de autoridade no nicho.
    4. Summary: Sinopse curta (2 frases).
    5. ColorTheme: Um código HEX de cor profissional (ex: #1e293b).
    6. ChapterTitles: Array com exatamente 5 títulos de capítulos.
  `;

  let outline: OutlineData;

  try {
      const outlineResponse = await callWithRetry<GenerateContentResponse>("Gerar Estrutura", () => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: outlinePrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              subtitle: { type: Type.STRING },
              author: { type: Type.STRING },
              summary: { type: Type.STRING },
              colorTheme: { type: Type.STRING },
              chapterTitles: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              }
            }
          }
        }
      }));

      if (!outlineResponse.text) throw new Error("Resposta vazia da IA.");
      outline = JSON.parse(outlineResponse.text) as OutlineData;
  } catch (e) {
      console.error("Falha na estrutura:", e);
      throw new Error("Não foi possível conectar à IA. Verifique sua chave de API ou tente novamente.");
  }

  // STEP 2: Generate Content for Chapters
  const chapters: Array<{title: string, content: string, image?: string}> = [];
  const totalChapters = outline.chapterTitles.length;

  for (let i = 0; i < totalChapters; i++) {
    const chapterTitle = outline.chapterTitles[i];
    onProgress(`Escrevendo capítulo ${i + 1}/${totalChapters}: "${chapterTitle}"...`);

    const chapterPrompt = `
        Escreva o conteúdo para o capítulo: "${chapterTitle}" do livro "${outline.title}".
        Público: ${answers.who}. Nível: ${answers.level}.
        
        Gere um texto educativo, denso e direto (aprox 250 palavras).
        NÃO use formatação Markdown (negrito, itálico), apenas texto puro e parágrafos.
    `;

    const imagePrompt = `Minimalist corporate vector illustration for book chapter: "${chapterTitle}" about "${answers.what}". Soft colors, white background.`;
    
    try {
        // Generate Text
        const textResult = await callWithRetry<GenerateContentResponse>(`Texto Cap ${i+1}`, () => ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: chapterPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        content: { type: Type.STRING }
                    }
                }
            }
        }));
        
        // Generate Image (Parallel-ish but careful with rate limits)
        let imageBase64: string | undefined = undefined;
        try {
            await new Promise(r => setTimeout(r, 1000)); // Short cooling
            const imageResult = await callWithRetry<GenerateContentResponse>(`Imagem Cap ${i+1}`, () => ai.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: { parts: [{ text: imagePrompt }] },
                config: {
                     imageConfig: { aspectRatio: "16:9" }
                }
            }), 1); // Only 1 try for images to be faster

            if (imageResult && imageResult.candidates?.[0]?.content?.parts) {
                for (const part of imageResult.candidates[0].content.parts) {
                    if (part.inlineData) {
                        imageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        break;
                    }
                }
            }
        } catch (imgErr) {
            console.warn(`Imagem pulada para ${chapterTitle}`, imgErr);
        }

        const text = textResult.text ? JSON.parse(textResult.text).content : "Conteúdo indisponível.";
        chapters.push({ title: chapterTitle, content: text, image: imageBase64 });

        // Throttle slightly to respect TPM
        if (i < totalChapters - 1) await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (e) {
        console.error(`Erro no capítulo ${chapterTitle}`, e);
        chapters.push({ title: chapterTitle, content: "Erro na geração deste capítulo. O conteúdo foi omitido.", image: undefined });
    }
  }

  onProgress("Finalizando diagramação...");
  return { ...outline, chapters };
};

// --- PDF Service ---
const createPDF = (data: ContentData) => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;

  const hexToRgb = (hex: string) => {
    if (!hex || !hex.startsWith('#')) return { r: 30, g: 41, b: 59 };
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
  };

  const primaryColor = hexToRgb(data.colorTheme);

  // 1. CAPA
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, pageWidth, pageHeight, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(42);
  const titleLines = doc.splitTextToSize(data.title.toUpperCase(), pageWidth - (margin * 2.5));
  doc.text(titleLines, margin + 10, 80);

  const subY = 80 + (titleLines.length * 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.setTextColor(220, 220, 220);
  const subtitleLines = doc.splitTextToSize(data.subtitle, pageWidth - (margin * 2.5));
  doc.text(subtitleLines, margin + 10, subY);
  
  doc.setFontSize(12);
  doc.text(data.author.toUpperCase(), margin + 10, pageHeight - 30);

  // 2. CONTEÚDO
  const fontSize = 12;
  
  data.chapters.forEach((chapter, index) => {
    doc.addPage();
    
    // Header
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`${data.title}  |  Capítulo ${index + 1}`, margin, 15);
    doc.line(margin, 18, pageWidth - margin, 18);

    // Title
    doc.setFont("times", "bold");
    doc.setFontSize(26);
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    const titleCapLines = doc.splitTextToSize(chapter.title, pageWidth - (margin * 2));
    doc.text(titleCapLines, margin, 40);

    let currentY = 40 + (titleCapLines.length * 12) + 10;

    // Image
    if (chapter.image) {
        try {
            const imgWidth = pageWidth - (margin * 2);
            const imgHeight = imgWidth * (9/16);
            if (currentY + imgHeight > pageHeight - margin) {
                doc.addPage();
                currentY = 35;
            }
            doc.addImage(chapter.image, 'PNG', margin, currentY, imgWidth, imgHeight);
            currentY += imgHeight + 10;
        } catch (err) { console.error("PDF Image Error", err); }
    }

    // Text
    doc.setFont("times", "roman");
    doc.setFontSize(fontSize);
    doc.setTextColor(40, 40, 40);
    
    const textLines = doc.splitTextToSize(chapter.content || "", pageWidth - (margin * 2));
    
    textLines.forEach((line: string) => {
      if (currentY > pageHeight - margin) {
        doc.addPage();
        currentY = 35;
      }
      doc.text(line, margin, currentY);
      currentY += (fontSize / 2.5) * 1.8;
    });
  });

  doc.save(`${data.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
};

// --- Simulated Payment Utils ---
const createSimulatedSession = async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("session_id", "demo_session_" + Math.random().toString(36).substring(7));
    return { url: currentUrl.toString() };
}

const verifySimulatedPayment = async (sessionId: string) => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return sessionId.startsWith("demo_session_");
}


// --- Components ---

const Button = ({ children, onClick, variant = "primary", className = "", disabled = false }: any) => {
  const baseStyle = "px-8 py-4 rounded-xl font-medium transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-zen-800 text-white hover:bg-zen-900 shadow-lg hover:shadow-xl",
    secondary: "bg-white text-zen-800 border border-zen-200 hover:border-zen-400 hover:bg-zen-50",
    ghost: "text-zen-500 hover:text-zen-800 hover:bg-zen-100",
    success: "bg-green-600 text-white hover:bg-green-700 shadow-lg hover:shadow-xl",
    stripe: "bg-[#635BFF] text-white hover:bg-[#5851E3] shadow-lg hover:shadow-[#635BFF]/30",
  };
  
  if (disabled) {
    return (
        <button disabled className={`${baseStyle} bg-gray-200 text-gray-400 cursor-not-allowed transform-none shadow-none ${className}`}>
            {children}
        </button>
    )
  }

  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`}>
      {children}
    </button>
  );
};

const Card = ({ selected, children, onClick }: any) => (
  <div 
    onClick={onClick}
    className={`
      p-6 rounded-2xl cursor-pointer border-2 transition-all duration-300 flex flex-col items-center justify-center text-center gap-3 h-40
      ${selected 
        ? "border-zen-800 bg-zen-50 text-zen-900 shadow-md scale-105" 
        : "border-zen-200 bg-white text-zen-500 hover:border-zen-400 hover:text-zen-700 hover:shadow-sm"
      }
    `}
  >
    {children}
  </div>
);

const PaymentModal = ({ onClose }: { onClose: () => void }) => {
    const [loading, setLoading] = useState(false);

    const handleCheckout = async () => {
        setLoading(true);
        try {
            const session = await createSimulatedSession();
            if (session.url) {
                window.location.href = session.url;
            }
        } catch (e) {
            console.error(e);
            alert("Erro na simulação.");
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden relative">
                <button 
                    onClick={onClose} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                    ✕
                </button>
                
                <div className="p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-[#635BFF]/10 rounded-full flex items-center justify-center text-[#635BFF]">
                            <CreditCard size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">Finalizar Compra</h3>
                            <p className="text-xs text-gray-500">Checkout Simulado (Demo)</p>
                        </div>
                    </div>

                    <div className="mb-8 p-6 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-gray-700">Plano Premium</span>
                            <span className="font-bold text-3xl text-gray-900">R$ 29,90</span>
                        </div>
                        <div className="h-px bg-gray-200 my-4"></div>
                        <ul className="text-sm text-gray-600 space-y-3">
                            <li className="flex items-center gap-2"><Check size={16} className="text-green-500" /> Download do PDF em alta resolução</li>
                            <li className="flex items-center gap-2"><Check size={16} className="text-green-500" /> Ilustrações profissionais inclusas</li>
                            <li className="flex items-center gap-2"><Check size={16} className="text-green-500" /> Licença de uso comercial (PLR)</li>
                        </ul>
                    </div>
                    
                    <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg mb-4 flex gap-2">
                        <AlertTriangle size={16} className="text-yellow-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-yellow-700">
                            <strong>Modo Demo:</strong> Nenhuma cobrança real será feita. Clique abaixo para simular o sucesso do pagamento.
                        </p>
                    </div>

                    <Button 
                        onClick={handleCheckout} 
                        disabled={loading} 
                        variant="stripe"
                        className="w-full"
                    >
                        {loading ? "Processando..." : (
                            <>
                                Simular Pagamento <ArrowRight size={18} />
                            </>
                        )}
                    </Button>
                    
                    <div className="mt-4 flex justify-center gap-2 text-gray-400">
                        <ShieldCheck size={14} /> <span className="text-[10px] uppercase tracking-wider">Ambiente Seguro</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StepWizard = ({ onComplete }: { onComplete: (answers: Answers) => void }) => {
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<Answers>({
    what: "",
    who: "",
    where: "",
    objective: "",
    level: ""
  });

  const nextStep = () => {
    if (step < 5) setStep(step + 1);
    else onComplete(answers);
  };

  const updateAnswer = (key: keyof Answers, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (key !== "what") {
      setTimeout(() => {
        if (step < 5) setStep(prev => prev + 1);
        else onComplete({ ...answers, [key]: value });
      }, 400);
    }
  };

  const progress = (step / 5) * 100;

  return (
    <div className="w-full max-w-2xl mx-auto px-6 slide-up">
      {/* Progress Bar */}
      <div className="w-full h-1 bg-zen-200 rounded-full mb-12 overflow-hidden">
        <div 
          className="h-full bg-zen-800 transition-all duration-500 ease-out" 
          style={{ width: `${progress}%` }} 
        />
      </div>

      <div className="min-h-[400px]">
        {step === 1 && (
          <div className="space-y-6 fade-in">
            <h2 className="text-3xl font-serif text-zen-900">O que você faz ou vende?</h2>
            <p className="text-zen-500">Descreva em poucas palavras. Ex: "Vendo bolos caseiros" ou "Dou aulas de inglês".</p>
            <input 
              autoFocus
              type="text" 
              className="w-full text-2xl p-4 border-b-2 border-zen-200 focus:border-zen-800 outline-none bg-transparent transition-colors placeholder:text-zen-300"
              placeholder="Digite aqui..."
              value={answers.what}
              onChange={(e) => setAnswers(prev => ({ ...prev, what: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && answers.what && nextStep()}
            />
            {answers.what && (
              <div className="pt-8 flex justify-end">
                <Button onClick={nextStep}>
                  Continuar <ArrowRight size={20} />
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 fade-in">
            <h2 className="text-3xl font-serif text-zen-900">Para quem é esse material?</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Clientes", icon: <Users /> },
                { label: "Alunos", icon: <BookOpen /> },
                { label: "Seguidores", icon: <Sparkles /> },
                { label: "Equipe", icon: <Layers /> }
              ].map(opt => (
                <Card 
                  key={opt.label} 
                  selected={answers.who === opt.label}
                  onClick={() => updateAnswer("who", opt.label)}
                >
                  <div className="scale-125 mb-2">{opt.icon}</div>
                  <span className="font-medium">{opt.label}</span>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 fade-in">
            <h2 className="text-3xl font-serif text-zen-900">Onde será usado?</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                "WhatsApp",
                "E-book (PDF)",
                "Instagram",
                "Aula / Apostila"
              ].map(opt => (
                <Card 
                  key={opt} 
                  selected={answers.where === opt}
                  onClick={() => updateAnswer("where", opt)}
                >
                  <FileText className="mb-2" />
                  <span className="font-medium">{opt}</span>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8 fade-in">
            <h2 className="text-3xl font-serif text-zen-900">Qual o objetivo principal?</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                "Vender",
                "Ensinar",
                "Apresentar",
                "Engajar"
              ].map(opt => (
                <Card 
                  key={opt} 
                  selected={answers.objective === opt}
                  onClick={() => updateAnswer("objective", opt)}
                >
                  <Target className="mb-2" />
                  <span className="font-medium">{opt}</span>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-8 fade-in">
            <h2 className="text-3xl font-serif text-zen-900">Qual o nível do público?</h2>
            <div className="space-y-4">
              {["Iniciante", "Intermediário", "Avançado"].map(level => (
                <button
                  key={level}
                  onClick={() => updateAnswer("level", level)}
                  className={`w-full p-6 text-left text-xl rounded-xl border-2 transition-all duration-200 flex justify-between items-center group ${
                    answers.level === level 
                    ? "border-zen-800 bg-zen-50 text-zen-900" 
                    : "border-zen-100 bg-white text-zen-500 hover:border-zen-300"
                  }`}
                >
                  <span>{level}</span>
                  <ArrowRight className={`opacity-0 group-hover:opacity-100 transition-opacity ${answers.level === level ? "opacity-100" : ""}`} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App ---
const App = () => {
  const [view, setView] = useState<"landing" | "wizard" | "generating" | "result">("landing");
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [content, setContent] = useState<ContentData | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Iniciando...");
  const [showPayment, setShowPayment] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  useEffect(() => {
    // 1. Check for payment return (Demo)
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');

    if (sessionId) {
        setVerifyingPayment(true);
        setView("generating"); 
        setLoadingMessage("Confirmando licença...");

        verifySimulatedPayment(sessionId).then(success => {
            if (success) {
                setIsPaid(true);
                setShowPayment(false);
                // 2. Restore content
                const saved = localStorage.getItem('prontopdf_backup');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    setAnswers(parsed.answers);
                    setContent(parsed.content);
                    setView("result");
                } else {
                    setView("landing");
                }
            }
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            setVerifyingPayment(false);
        });
    }
  }, []);

  // 3. Save state
  useEffect(() => {
      if (content && answers) {
          localStorage.setItem('prontopdf_backup', JSON.stringify({ answers, content }));
      }
  }, [content, answers]);


  const startWizard = () => setView("wizard");

  const handleWizardComplete = async (finalAnswers: Answers) => {
    setAnswers(finalAnswers);
    setView("generating");
    setLoadingMessage("Iniciando a inteligência artificial...");
    
    try {
      const data = await generateMaterial(finalAnswers, (msg) => {
        setLoadingMessage(msg);
      });
      setContent(data);
      setView("result");
    } catch (e: any) {
      console.error(e);
      alert(`Erro: ${e.message || "Não foi possível gerar o conteúdo. Verifique sua conexão."}`);
      setView("landing");
    }
  };

  const handleDownload = () => {
    if (!isPaid) {
        setShowPayment(true);
        return;
    }
    if (content) createPDF(content);
  };

  const reset = () => {
    if (confirm("Tem certeza? Você perderá o livro atual.")) {
        setAnswers(null);
        setContent(null);
        setIsPaid(false);
        setView("landing");
        localStorage.removeItem('prontopdf_backup');
    }
  };

  return (
    <div className="min-h-screen font-sans text-zen-800 selection:bg-zen-200">
      {showPayment && <PaymentModal onClose={() => setShowPayment(false)} />}
      
      {/* Header */}
      <nav className="p-6 flex justify-between items-center max-w-6xl mx-auto">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href = "/"}>
          <div className="w-8 h-8 bg-zen-800 rounded-lg flex items-center justify-center text-white">
            <Sparkles size={16} />
          </div>
          <span className="font-serif font-bold text-xl tracking-tight">ProntoPDF</span>
        </div>
        {view !== "landing" && !verifyingPayment && (
          <button onClick={reset} className="text-sm text-zen-500 hover:text-zen-800">Início</button>
        )}
      </nav>

      {/* Main Content Area */}
      <main className="flex flex-col items-center justify-center min-h-[80vh] w-full max-w-6xl mx-auto p-6 relative">
        
        {view === "landing" && (
          <div className="text-center space-y-8 max-w-3xl fade-in">
            <div className="inline-block px-4 py-1.5 rounded-full bg-zen-100 text-zen-600 text-sm font-medium mb-4">
              Simplifique sua vida profissional
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-zen-900 leading-tight">
              Você não precisa pensar.<br/>
              <span className="text-zen-500">Nós fazemos por você.</span>
            </h1>
            <p className="text-xl text-zen-600 max-w-2xl mx-auto leading-relaxed">
              Um assistente inteligente que decide, escreve e formata <strong>E-books completos</strong> para o seu negócio.
            </p>
            <div className="pt-8">
              <Button onClick={startWizard} className="mx-auto text-lg px-10 py-5">
                Começar Agora
              </Button>
              <p className="mt-4 text-sm text-zen-400">Teste grátis • Sem cadastro • PDF Profissional</p>
            </div>
          </div>
        )}

        {view === "wizard" && (
          <StepWizard onComplete={handleWizardComplete} />
        )}

        {view === "generating" && (
          <div className="text-center space-y-8 fade-in">
            <div className="w-24 h-24 mx-auto relative">
              <div className="absolute inset-0 border-4 border-zen-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-zen-800 rounded-full border-t-transparent animate-spin"></div>
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-serif text-zen-900 min-h-[40px] transition-all">
                {loadingMessage}
              </h3>
              <p className="text-zen-500">Isso pode levar cerca de 30-60 segundos para um livro completo.</p>
            </div>
          </div>
        )}

        {view === "result" && content && (
          <div className="w-full grid md:grid-cols-2 gap-12 items-center fade-in slide-up">
            {/* Left: Preview */}
            <div className="order-2 md:order-1 relative group">
              <div className="absolute inset-0 bg-zen-200 transform rotate-3 rounded-xl transition-transform group-hover:rotate-6"></div>
              <div 
                className="relative bg-white aspect-[3/4] rounded-xl shadow-2xl overflow-hidden border border-zen-100 flex flex-col"
              >
                {/* Simulated Modern Cover Preview */}
                <div 
                   className="flex-1 p-8 flex flex-col justify-between"
                   style={{ backgroundColor: content.colorTheme }}
                >
                    {/* Watermark for unpaid */}
                    {!isPaid && (
                        <div className="absolute inset-0 z-20 bg-black/10 backdrop-blur-[2px] flex items-center justify-center">
                            <div className="bg-white/90 px-6 py-3 rounded-full shadow-lg flex items-center gap-2">
                                <Lock size={16} className="text-gray-500"/>
                                <span className="font-bold text-gray-800 text-sm tracking-widest uppercase">Preview Bloqueado</span>
                            </div>
                        </div>
                    )}

                    <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-10 rounded-full translate-x-1/2 -translate-y-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-white opacity-10 rounded-full -translate-x-1/2 translate-y-1/2"></div>
                    
                    <div className="z-10 mt-10">
                      <h1 className="text-3xl font-bold text-white leading-tight font-sans">
                        {content.title}
                      </h1>
                      <p className="text-white/80 mt-2 font-light">
                        {content.subtitle}
                      </p>
                    </div>

                    <div className="z-10 mb-4">
                       <div className="h-0.5 w-12 bg-white/50 mb-4"></div>
                       <p className="text-xs text-white/70 tracking-widest uppercase">
                         {content.author}
                       </p>
                    </div>
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="order-1 md:order-2 space-y-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 font-medium bg-green-50 px-3 py-1 rounded-full w-fit">
                  <Check size={16} /> E-book Completo Gerado
                </div>
                <h2 className="text-4xl font-serif text-zen-900">Seu livro está pronto.</h2>
                <p className="text-zen-600 leading-relaxed">
                  Criamos um material denso com <strong>{content.chapters.length} capítulos detalhados</strong>.
                  O design da capa foi atualizado para um padrão minimalista e moderno.
                </p>
                <div className="bg-zen-50 p-6 rounded-xl border border-zen-100">
                  <h4 className="font-semibold text-zen-800 mb-2 text-sm uppercase tracking-wider">Conteúdo</h4>
                  <ul className="text-zen-600 text-sm space-y-1">
                    {content.chapters.slice(0, 5).map((c, i) => (
                      <li key={i} className="truncate">• {c.title}</li>
                    ))}
                    {content.chapters.length > 5 && (
                       <li className="text-zen-400 italic">+ {content.chapters.length - 5} outros capítulos...</li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                {isPaid ? (
                    <Button onClick={handleDownload} variant="success" className="flex-1">
                        <Download size={20} /> Baixar PDF Completo
                    </Button>
                ) : (
                    <Button onClick={handleDownload} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
                        <Lock size={18} /> Liberar Acesso (R$ 29,90)
                    </Button>
                )}
                
                <Button onClick={reset} variant="secondary" className="flex-1">
                  <RefreshCw size={20} /> Criar Novo
                </Button>
              </div>
              
              <div className="text-center space-y-1">
                  {isPaid ? (
                     <p className="text-xs text-green-600 font-medium flex items-center justify-center gap-1">
                         <Star size={12} fill="currentColor" /> Licença Premium Ativada
                     </p>
                  ) : (
                    <p className="text-xs text-zen-400">
                        Pagamento único. Acesso vitalício. Garantia de 7 dias.
                    </p>
                  )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);