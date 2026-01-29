import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
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
  FileText 
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

// --- Globals ---
declare global {
  interface Window {
    jspdf: any;
  }
}

// --- AI Service ---
const generateMaterial = async (answers: Answers, onProgress: (msg: string) => void): Promise<ContentData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // STEP 1: Generate Outline & Metadata
  onProgress("Criando estrutura, capa e sumário...");
  
  const outlinePrompt = `
    Você é um editor sênior de livros best-sellers.
    Crie a ESTRUTURA ESTRATÉGICA para um E-book profissional.
    
    INFORMAÇÕES:
    Tema: ${answers.what}
    Público: ${answers.who}
    Formato: ${answers.where}
    Objetivo: ${answers.objective}
    Nível: ${answers.level}

    REQUISITOS:
    1. Defina um Título e Subtítulo altamente vendáveis.
    2. Crie uma lista de **15 CAPÍTULOS** que cubram o tema profundamente.
    3. Defina uma cor tema sóbria e profissional (hex).
    4. Crie um resumo (sinopse) convincente.
  `;

  const outlineResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: outlinePrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          author: { type: Type.STRING, description: "Nome do especialista/autor" },
          summary: { type: Type.STRING },
          colorTheme: { type: Type.STRING },
          chapterTitles: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Lista exata de 15 títulos de capítulos"
          }
        }
      }
    }
  });

  if (!outlineResponse.text) throw new Error("Falha ao gerar estrutura.");
  const outline = JSON.parse(outlineResponse.text) as OutlineData;

  // STEP 2: Generate Content for Chapters (Batched to avoid timeouts)
  const chapters: Array<{title: string, content: string}> = [];
  const batchSize = 3; // Process 3 chapters concurrently to avoid rate limits/timeouts
  
  const totalChapters = outline.chapterTitles.length;

  for (let i = 0; i < totalChapters; i += batchSize) {
    const batch = outline.chapterTitles.slice(i, i + batchSize);
    const startIdx = i + 1;
    const endIdx = Math.min(i + batchSize, totalChapters);
    
    onProgress(`Escrevendo capítulos ${startIdx} a ${endIdx} de ${totalChapters}...`);

    const batchPromises = batch.map(async (chapterTitle) => {
        const chapterPrompt = `
            Atue como o autor do livro "${outline.title}".
            Escreva o CONTEÚDO COMPLETO para o capítulo: "${chapterTitle}".
            
            Público: ${answers.who}
            Nível: ${answers.level}
            
            REQUISITOS DO TEXTO:
            - Texto denso e educativo (aprox. 400-500 palavras).
            - Use parágrafos claros.
            - Seja prático: dê exemplos ou passos quando possível.
            - IMPORTANTE: Retorne APENAS texto corrido. NÃO use formatação Markdown (como **negrito** ou # titulos), pois isso quebra o PDF final.
        `;
        
        try {
            const result = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: chapterPrompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            content: { type: Type.STRING, description: "O texto completo do capítulo, sem markdown." }
                        }
                    }
                }
            });
            const text = result.text ? JSON.parse(result.text).content : "Conteúdo não gerado.";
            return { title: chapterTitle, content: text };
        } catch (e) {
            console.error(`Erro no capítulo ${chapterTitle}`, e);
            return { title: chapterTitle, content: "Ocorreu um erro ao gerar este capítulo. Tente regenerar o material." };
        }
    });

    const batchResults = await Promise.all(batchPromises);
    chapters.push(...batchResults);
  }

  onProgress("Finalizando formatação...");

  return {
    title: outline.title,
    subtitle: outline.subtitle,
    author: outline.author,
    summary: outline.summary,
    colorTheme: outline.colorTheme,
    chapters: chapters
  };
};

// --- PDF Service ---
const createPDF = (data: ContentData) => {
  const { jsPDF } = window.jspdf;
  // Initialize standard A4 PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth(); // ~210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // ~297mm
  const margin = 20;

  // --- Helper Functions ---
  const hexToRgb = (hex: string) => {
    // Default fallback
    if (!hex || !hex.startsWith('#')) return { r: 30, g: 41, b: 59 };
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  const primaryColor = hexToRgb(data.colorTheme);

  // --- 1. CAPA (Cover) ---
  // Fundo Total
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Elementos Gráficos Abstratos (Modern Design)
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  doc.setFillColor(255, 255, 255);
  doc.circle(pageWidth, 0, 140, "F"); // Círculo canto superior direito
  doc.circle(0, pageHeight, 100, "F"); // Círculo canto inferior esquerdo
  doc.rect(margin, pageHeight / 2, 5, 40, "F"); // Detalhe vertical
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Título
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(42);
  const titleLines = doc.splitTextToSize(data.title.toUpperCase(), pageWidth - (margin * 2.5));
  doc.text(titleLines, margin + 10, 80);

  // Subtítulo
  const subY = 80 + (titleLines.length * 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.setTextColor(220, 220, 220);
  const subtitleLines = doc.splitTextToSize(data.subtitle, pageWidth - (margin * 2.5));
  doc.text(subtitleLines, margin + 10, subY);

  // Badge "Guia Completo"
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.5);
  doc.line(margin + 10, subY + 20, margin + 40, subY + 20);
  
  // Autor (Rodapé da capa)
  doc.setFontSize(12);
  doc.setTextColor(200, 200, 200);
  doc.text(data.author.toUpperCase(), margin + 10, pageHeight - 30);

  // --- 2. SUMÁRIO (Table of Contents) ---
  doc.addPage();
  doc.setFillColor(255, 255, 255); // Reset bg
  
  // Título do Sumário
  doc.setFont("times", "bold");
  doc.setFontSize(24);
  doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.text("Sumário", margin, 40);

  // Linha decorativa
  doc.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.setLineWidth(1);
  doc.line(margin, 45, pageWidth - margin, 45);

  // Lista de Capítulos
  let tocY = 60;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);

  data.chapters.forEach((chapter, index) => {
    if (tocY > pageHeight - 30) {
      doc.addPage();
      tocY = 40;
    }
    const chapterNum = String(index + 1).padStart(2, '0');
    doc.text(`${chapterNum}. ${chapter.title}`, margin, tocY);
    tocY += 10;
  });

  // --- 3. CONTEÚDO (Chapters) ---
  const fontSize = 12;
  
  data.chapters.forEach((chapter, index) => {
    doc.addPage();
    
    // Cabeçalho da página
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`${data.title}  |  Capítulo ${index + 1}`, margin, 15);
    doc.line(margin, 18, pageWidth - margin, 18);

    // Título do Capítulo (Destaque)
    doc.setFont("times", "bold");
    doc.setFontSize(26);
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    const titleCapLines = doc.splitTextToSize(chapter.title, pageWidth - (margin * 2));
    doc.text(titleCapLines, margin, 40);

    // Texto do Capítulo
    doc.setFont("times", "roman"); // Times é melhor para leitura longa
    doc.setFontSize(fontSize);
    doc.setTextColor(40, 40, 40);
    
    const startY = 40 + (titleCapLines.length * 12) + 10;
    
    // Sanitize content just in case
    const safeContent = chapter.content || "";
    const textLines = doc.splitTextToSize(safeContent, pageWidth - (margin * 2));
    
    // Renderização manual para controle de página
    let cursorY = startY;
    
    textLines.forEach((line: string) => {
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        // Cabeçalho na nova página também
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(150, 150, 150);
        doc.text(`${data.title}  |  Capítulo ${index + 1} (cont.)`, margin, 15);
        doc.line(margin, 18, pageWidth - margin, 18);
        
        // Reset fonte corpo
        doc.setFont("times", "roman");
        doc.setFontSize(fontSize);
        doc.setTextColor(40, 40, 40);
        cursorY = 35;
      }
      doc.text(line, margin, cursorY);
      cursorY += (fontSize / 2.5) * 1.8; // Espaçamento de linha
    });
  });

  // --- 4. CONTRACAPA (Back Cover) ---
  doc.addPage();
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Texto de fechamento
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Resumo do Material", margin, 60);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  const summaryLines = doc.splitTextToSize(data.summary, pageWidth - (margin * 2));
  doc.text(summaryLines, margin, 80);

  // Logo ou Brand final
  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  doc.text("Gerado com ProntoPDF", pageWidth / 2, pageHeight - 20, { align: "center" });

  // --- 5. AGRADECIMENTOS (Acknowledgements) ---
  doc.addPage();
  doc.setFillColor(255, 255, 255); // White bg
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Header/Title
  doc.setFont("times", "bold");
  doc.setFontSize(24);
  doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.text("Agradecimentos", margin, 40);

  // Decorative Line
  doc.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.setLineWidth(0.5);
  doc.line(margin, 45, pageWidth / 2, 45);

  // Body Text
  doc.setFont("times", "roman");
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  
  const ackText = "Obrigado por dedicar seu tempo à leitura deste material.\n\nEsperamos que o conteúdo compartilhado aqui tenha sido útil e inspirador para sua jornada. O conhecimento é uma ferramenta poderosa de transformação, e ficamos felizes em fazer parte do seu aprendizado.\n\nEste material foi criado com o objetivo de simplificar processos e entregar valor real, permitindo que você foque no que realmente importa: aplicar e evoluir.";
  
  const ackLines = doc.splitTextToSize(ackText, pageWidth - (margin * 2));
  doc.text(ackLines, margin, 60);

  // ProntoPDF Box
  const boxY = 60 + (ackLines.length * 6) + 30;
  
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, boxY, pageWidth - (margin * 2), 40, 3, 3, "S");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.text("Tecnologia ProntoPDF", margin + 5, boxY + 10);
  
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  const toolDesc = "Este documento foi estruturado, redigido e diagramado automaticamente utilizando a inteligência artificial do ProntoPDF.";
  const toolLines = doc.splitTextToSize(toolDesc, pageWidth - (margin * 2) - 10);
  doc.text(toolLines, margin + 5, boxY + 20);

  doc.save(`${data.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
};

// --- Components ---

const Button = ({ children, onClick, variant = "primary", className = "" }: any) => {
  const baseStyle = "px-8 py-4 rounded-xl font-medium transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-zen-800 text-white hover:bg-zen-900 shadow-lg hover:shadow-xl",
    secondary: "bg-white text-zen-800 border border-zen-200 hover:border-zen-400 hover:bg-zen-50",
    ghost: "text-zen-500 hover:text-zen-800 hover:bg-zen-100",
  };
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
    } catch (e) {
      console.error(e);
      alert("Houve um erro de conexão. O processo demorou muito. Tente novamente.");
      setView("landing");
    }
  };

  const handleDownload = () => {
    if (content) createPDF(content);
  };

  const reset = () => {
    setAnswers(null);
    setContent(null);
    setView("landing");
  };

  return (
    <div className="min-h-screen font-sans text-zen-800 selection:bg-zen-200">
      
      {/* Header */}
      <nav className="p-6 flex justify-between items-center max-w-6xl mx-auto">
        <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
          <div className="w-8 h-8 bg-zen-800 rounded-lg flex items-center justify-center text-white">
            <Sparkles size={16} />
          </div>
          <span className="font-serif font-bold text-xl tracking-tight">ProntoPDF</span>
        </div>
        {view !== "landing" && (
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
                <Button onClick={handleDownload} className="flex-1">
                  <Download size={20} /> Baixar PDF Completo
                </Button>
                <Button onClick={reset} variant="secondary" className="flex-1">
                  <RefreshCw size={20} /> Criar Novo
                </Button>
              </div>
              
              <p className="text-center text-xs text-zen-400">
                Documento formatado automaticamente com capa, sumário e numeração.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);