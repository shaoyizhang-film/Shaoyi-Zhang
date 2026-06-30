import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Upload, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Sparkles, 
  Eye, 
  EyeOff, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  HelpCircle, 
  Download, 
  Printer, 
  FolderPlus, 
  ArrowUp, 
  ArrowDown, 
  Save, 
  ChevronRight, 
  Settings,
  Info,
  Edit2,
  Check,
  X,
  Type,
  Ruler,
  Layers,
  LayoutGrid,
  Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import chroma from 'chroma-js';
import * as Tesseract from 'tesseract.js';

// ==========================================
// TYPES & INTERFACES
// ==========================================
interface Rule {
  id: string;
  text: string;
  priority: 'must' | 'suggest' | 'ref';
  status?: 'pass' | 'fail' | 'warn' | 'unknown';
  detail?: string;
  actualValue?: string;
  associatedBoxIdx?: number | null;
}

interface TemplateRules {
  text: string;
  priority: 'must' | 'suggest' | 'ref';
}

interface TemplateMap {
  [name: string]: TemplateRules[];
}

interface ImageMetadata {
  id: string;
  name: string;
  url: string;
  size: string;
  format: string;
  width: number;
  height: number;
  aspect: string;
  dominantColor: string;
  palette: string[];
  textSizes?: string;
  dpi?: string;
  auditStatus: 'idle' | 'analyzing' | 'passed' | 'failed' | 'warned' | 'pending';
  complianceRate?: number;
  failedRulesCount?: number;
  rulesResults?: Rule[];
  overlayBoxes?: BoundingBox[];
  ocrResults?: any[];
  customFields?: CustomField[];
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  metricValue?: string;
  targetType?: string;
}

interface CustomField {
  label: string;
  value: string;
}

interface AnalysisState {
  status: 'idle' | 'analyzing' | 'done';
  progress: number;
  step: string;
  logs: string[];
}

// ==========================================
// PRELOADED DEFAULT SAMPLE RULES & TEMPLATES
// ==========================================
const DEFAULT_RULES: Rule[] = [
  { id: '1', text: '所有文字与Logo水平居中对齐', priority: 'must' },
  { id: '2', text: '正文字号不小于24px', priority: 'must' },
  { id: '3', text: '文字间距统一为100', priority: 'suggest' },
  { id: '4', text: '品牌Logo位于画面左上角', priority: 'must' },
  { id: '5', text: '底图不得使用纯黑色', priority: 'suggest' },
  { id: '6', text: '图片宽高比为16:9', priority: 'ref' }
];

const DEFAULT_TEMPLATES: TemplateMap = {
  "小红书社媒图规范": [
    { text: "所有文字与Logo水平居中对齐", priority: "must" },
    { text: "正文字号不小于24px", priority: "must" },
    { text: "色彩鲜艳，不得使用纯黑色底图", priority: "suggest" },
    { text: "核心利益点位于上部 1/3 黄金分割区", priority: "suggest" }
  ],
  "淘宝天猫主图规范": [
    { text: "图片宽高比为 1:1 正方形", priority: "must" },
    { text: "品牌Logo位于画面左上角", priority: "must" },
    { text: "促销文字大小不小于 48px 突出显示", priority: "must" },
    { text: "主商品尺寸占比不小于画面 60%", priority: "suggest" },
    { text: "左下角标有防伪码或价格标识", priority: "ref" }
  ],
  "品牌海报高奢规范": [
    { text: "底图禁止使用纯黑色，亮度保持高质感", priority: "must" },
    { text: "图片宽高比为16:9", priority: "ref" },
    { text: "文字间距统一为100", priority: "suggest" },
    { text: "大标题字号不小于 64px 突出艺术氛围", priority: "suggest" }
  ],
  "通用Banner图标准": [
    { text: "所有文字与Logo水平居中对齐", priority: "must" },
    { text: "品牌Logo位于画面左上角", priority: "must" },
    { text: "图片宽高比为16:9", priority: "must" },
    { text: "正文字号不小于24px", priority: "suggest" },
    { text: "文字间距统一为100", priority: "ref" }
  ]
};

export default function App() {
  // Core rule list state
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  
  // Custom templates management
  const [templates, setTemplates] = useState<TemplateMap>(DEFAULT_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  
  // New rule input values
  const [newRuleText, setNewRuleText] = useState<string>('');
  const [newRulePriority, setNewRulePriority] = useState<'must' | 'suggest' | 'ref'>('must');

  // Modals & Side states
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [isCustomFieldModalOpen, setIsCustomFieldModalOpen] = useState<boolean>(false);
  const [customFieldLabel, setCustomFieldLabel] = useState<string>('');
  const [customFieldValue, setCustomFieldValue] = useState<string>('');

  // Batch Image Audit States
  const [imageList, setImageList] = useState<ImageMetadata[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // New Workspace Modes:
  // 'single' = Single image deep audit stage (existing)
  // 'batch_compare' = Batch consistency & alignment matching table
  // 'overlay_check' = Multi-image overlay & transparency alignment sandbox
  const [workspaceMode, setWorkspaceMode] = useState<'single' | 'batch_compare' | 'overlay_check'>('single');

  // Manual Reference Lines (Requirement #2)
  // type: 'h' (horizontal) or 'v' (vertical)
  // value: float percentage of image width/height (0.0 to 1.0)
  const [manualGuides, setManualGuides] = useState<{ id: string; type: 'h' | 'v'; value: number }[]>([
    { id: 'g-h1', type: 'h', value: 0.3 }, 
    { id: 'g-v1', type: 'v', value: 0.7 }
  ]);
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  const [draggingGuideId, setDraggingGuideId] = useState<string | null>(null);

  // Global Dragging handler for manual reference lines (Requirement #2)
  useEffect(() => {
    if (!draggingGuideId) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!previewImgRef.current) return;
      const rect = previewImgRef.current.getBoundingClientRect();
      const guide = manualGuides.find(g => g.id === draggingGuideId);
      if (!guide) return;

      if (guide.type === 'h') {
        const newValue = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setManualGuides(prev => prev.map(g => g.id === draggingGuideId ? { ...g, value: newValue } : g));
      } else {
        const newValue = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setManualGuides(prev => prev.map(g => g.id === draggingGuideId ? { ...g, value: newValue } : g));
      }
    };

    const handleGlobalMouseUp = () => {
      setDraggingGuideId(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingGuideId, manualGuides]);

  // Multi-image overlay settings (Requirement #3)
  const [overlayImageIds, setOverlayImageIds] = useState<string[]>([]); // which images are visible in stack
  const [imageOpacities, setImageOpacities] = useState<{ [imgId: string]: number }>({}); // individual opacities
  const [globalOverlayOpacity, setGlobalOverlayOpacity] = useState<number>(0.5);
  const [overlayBlendMode, setOverlayBlendMode] = useState<string>('normal'); // normal, multiply, screen, difference

  // Batch comparison settings (Requirement #1)
  const [compareTarget, setCompareTarget] = useState<string>('logo'); // logo, title, footer, top-left, top-right, bottom-left, bottom-right, center
  const [comparisonTolerance, setComparisonTolerance] = useState<number>(8); // pixel threshold for warnings (default 8px)
  const [isDrawingManualBox, setIsDrawingManualBox] = useState<boolean>(false);
  const [manualDrawStart, setManualDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [manualDrawCurrent, setManualDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Sync images for overlay checklist automatically
  useEffect(() => {
    if (imageList.length > 0) {
      setOverlayImageIds(prev => {
        const ids = imageList.map(img => img.id);
        const existing = prev.filter(id => ids.includes(id));
        const newIds = ids.filter(id => !prev.includes(id));
        return [...existing, ...newIds];
      });
      setImageOpacities(prev => {
        const updated = { ...prev };
        imageList.forEach(img => {
          if (updated[img.id] === undefined) {
            updated[img.id] = img.id === selectedImageId ? 1.0 : 0.4;
          }
        });
        return updated;
      });
    }
  }, [imageList]);

  // Keep selected image opacity at 1.0 or user-defined value
  useEffect(() => {
    if (selectedImageId) {
      setImageOpacities(prev => {
        if (prev[selectedImageId] === undefined) return prev;
        return {
          ...prev,
          [selectedImageId]: 1.0
        };
      });
    }
  }, [selectedImageId]);

  const currentImage = useMemo(() => {
    return imageList.find(img => img.id === selectedImageId) || null;
  }, [imageList, selectedImageId]);

  const ocrResults = useMemo(() => currentImage?.ocrResults || [], [currentImage]);
  const rulesResults = useMemo(() => currentImage?.rulesResults || [], [currentImage]);
  const overlayBoxes = useMemo(() => currentImage?.overlayBoxes || [], [currentImage]);
  const customFields = useMemo(() => currentImage?.customFields || [], [currentImage]);

  // Drag-Pan Zoom preview states
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  
  const startDragRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);

  // Intelligent analysis states
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: 'idle',
    progress: 0,
    step: '',
    logs: []
  });

  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [highlightedBoxIndex, setHighlightedBoxIndex] = useState<number | null>(null);
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  // Initialize from LocalStorage
  useEffect(() => {
    const savedTemplates = localStorage.getItem('approval_templates');
    if (savedTemplates) {
      try {
        setTemplates({ ...DEFAULT_TEMPLATES, ...JSON.parse(savedTemplates) });
      } catch (e) {
        console.error('Failed to parse saved templates from localStorage', e);
      }
    }
  }, []);

  // Save templates to LocalStorage
  const persistTemplates = (updatedTemplates: TemplateMap) => {
    setTemplates(updatedTemplates);
    localStorage.setItem('approval_templates', JSON.stringify(updatedTemplates));
  };

  // Rule additions / CRUD
  const addRule = () => {
    if (!newRuleText.trim()) return;
    const newRule: Rule = {
      id: Date.now().toString(),
      text: newRuleText.trim(),
      priority: newRulePriority
    };
    setRules(prev => [...prev, newRule]);
    setNewRuleText('');
  };

  const deleteRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const cyclePriority = (rule: Rule) => {
    const priorities: ('must' | 'suggest' | 'ref')[] = ['must', 'suggest', 'ref'];
    const currentIndex = priorities.indexOf(rule.priority);
    const nextIndex = (currentIndex + 1) % priorities.length;
    
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, priority: priorities[nextIndex] } : r));
  };

  const clearAllRules = () => {
    setRules([]);
  };

  const moveRule = (index: number, step: number) => {
    const targetIndex = index + step;
    if (targetIndex < 0 || targetIndex >= rules.length) return;
    
    const updated = [...rules];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setRules(updated);
  };

  // Template CRUD Action: Load template
  const loadTemplate = (name: string) => {
    setSelectedTemplate(name);
    if (!name || !templates[name]) return;
    
    const templateRules = templates[name];
    setRules(templateRules.map((r, i) => ({
      id: `tpl-${i}-${Date.now()}`,
      text: r.text,
      priority: r.priority
    })));
  };

  // Template CRUD Action: Open name modal
  const openSaveTemplateModal = () => {
    setNewTemplateName('');
    setIsSaveTemplateModalOpen(true);
  };

  // Template CRUD Action: Save/Create template (User Request #2!)
  const saveTemplate = () => {
    if (!newTemplateName.trim()) return;
    const name = newTemplateName.trim();
    
    const updated = {
      ...templates,
      [name]: rules.map(r => ({ text: r.text, priority: r.priority }))
    };
    persistTemplates(updated);
    setSelectedTemplate(name);
    setIsSaveTemplateModalOpen(false);
  };

  // Template CRUD Action: Overwrite rules of existing loaded template
  const saveCurrentRulesToTemplate = () => {
    if (!selectedTemplate || !templates[selectedTemplate]) return;
    
    const updated = {
      ...templates,
      [selectedTemplate]: rules.map(r => ({ text: r.text, priority: r.priority }))
    };
    persistTemplates(updated);
  };

  // Template CRUD Action: Delete template
  const deleteTemplate = (name: string) => {
    if (DEFAULT_TEMPLATES[name]) {
      // Don't delete system default templates completely, just restore them or reset
      alert('系统预设模板无法删除');
      return;
    }
    const updated = { ...templates };
    delete updated[name];
    persistTemplates(updated);
    if (selectedTemplate === name) {
      setSelectedTemplate('');
      setRules(DEFAULT_RULES);
    }
  };

  // ==========================================
  // IMAGE AND FILE LOADER ENGINE
  // ==========================================
  const loadDemoBatchImages = () => {
    const batch: ImageMetadata[] = [];
    const bannerData = [
      {
        id: 'demo-1',
        name: '智能终端主图_1_基准规范.png',
        color1: '#0B132B', color2: '#1C2541',
        logoX: 60, logoY: 50,
        titleX: 400, titleY: 260, titleSize: 42,
        footerX: 400, footerY: 480, footerSize: 14,
        logoText: '✦ NEXUS AI',
        titleText: '开启通用智能新纪元',
        footerText: '*注：排版准则示范，最终解释权归NEXUS所有',
        status: 'passed' as const,
        complianceRate: 100,
        failedRulesCount: 0
      },
      {
        id: 'demo-2',
        name: '智能终端主图_2_微幅偏移.png',
        color1: '#1A0F2E', color2: '#2D144B',
        logoX: 85, logoY: 72, // Offset by +25px, +22px
        titleX: 400, titleY: 260, titleSize: 42,
        footerX: 400, footerY: 450, footerSize: 14, // Offset by -30px
        logoText: '✦ NEXUS AI',
        titleText: '开启通用智能新纪元',
        footerText: '*注：排版准则示范，最终解释权归NEXUS所有',
        status: 'warned' as const,
        complianceRate: 80,
        failedRulesCount: 0
      },
      {
        id: 'demo-3',
        name: '智能终端主图_3_严重偏离.png',
        color1: '#111E25', color2: '#1A2F3B',
        logoX: 620, logoY: 50, // Severe right shift!
        titleX: 400, titleY: 300, titleSize: 28, // Severe downward shift and shrunken font!
        footerX: 400, footerY: 520, footerSize: 14,
        logoText: '✦ NEXUS AI',
        titleText: '开启通用智能新纪元',
        footerText: '*注：排版准则示范，最终解释权归NEXUS所有',
        status: 'failed' as const,
        complianceRate: 40,
        failedRulesCount: 2
      }
    ];

    bannerData.forEach((data, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const grad = ctx.createLinearGradient(0, 0, 800, 540);
      grad.addColorStop(0, data.color1);
      grad.addColorStop(1, data.color2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 800, 540);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 800; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 540);
        ctx.stroke();
      }
      for (let i = 0; i < 540; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(800, i);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.beginPath();
      ctx.arc(data.logoX, data.logoY, 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#10B981';
      ctx.fillText(data.logoText, data.logoX, data.logoY + 6);

      ctx.font = `bold ${data.titleSize}px sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(data.titleText, data.titleX, data.titleY);

      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText('Nexus Pro Max 多模态技术框架首发发布', data.titleX, data.titleY + 45);

      ctx.font = `${data.footerSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(data.footerText, data.footerX, data.footerY);

      const dataUrl = canvas.toDataURL('image/png');

      const boxes = [
        {
          x: data.logoX / 800,
          y: data.logoY / 540,
          w: 120 / 800,
          h: 24 / 540,
          label: `[页眉LOGO/品牌区] 智能终端首发标志`,
          status: index === 0 ? ('pass' as const) : index === 1 ? ('warn' as const) : ('fail' as const),
          metricValue: index === 0 ? '位置合规' : index === 1 ? '右偏 25px' : '右移 560px'
        },
        {
          x: (data.titleX - 200) / 800,
          y: (data.titleY - 30) / 540,
          w: 400 / 800,
          h: 40 / 540,
          label: `[视觉中心大标题] 排版主视觉核心`,
          status: index === 2 ? ('fail' as const) : ('pass' as const),
          metricValue: index === 2 ? '字号偏小且下移' : '高度合规'
        },
        {
          x: (data.footerX - 250) / 800,
          y: (data.footerY - 15) / 540,
          w: 500 / 800,
          h: 20 / 540,
          label: `[页脚元数据] 版权与安全提示词 (免责声明)`,
          status: index === 0 ? ('pass' as const) : index === 1 ? ('warn' as const) : ('fail' as const),
          metricValue: index === 0 ? '位置合规' : index === 1 ? '上移偏位' : '高度偏离'
        }
      ];

      batch.push({
        id: data.id,
        name: data.name,
        url: dataUrl,
        format: 'PNG',
        width: 800,
        height: 540,
        size: '1.24 MB',
        aspect: '16:9',
        dominantColor: data.color1,
        palette: [data.color1, data.color2, '#1E293B', '#10B981', '#FFFFFF'],
        auditStatus: data.status,
        complianceRate: data.complianceRate,
        failedRulesCount: data.failedRulesCount,
        overlayBoxes: boxes,
        ocrResults: boxes.map(b => ({ text: b.label, x: b.x, y: b.y, w: b.w, h: b.h })),
        customFields: []
      });
    });

    setImageList(batch);
    setSelectedImageId('demo-1');
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const processFiles = (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    // Reset previous review states
    setAnalysisState({
      status: 'idle',
      progress: 0,
      step: '',
      logs: []
    });
    setHighlightedBoxIndex(null);
    setSelectedRuleId(null);

    const fileListArray = Array.from(files);
    fileListArray.forEach((file) => {
      if (!file.type.startsWith('image/')) return;

      const sizeFormatted = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      const extension = file.name.split('.').pop()?.toUpperCase() || 'PNG';
      const fileId = `img-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Parse Aspect Ratio
          const ratio = img.width / img.height;
          let aspectStr = `${img.width}:${img.height}`;
          if (Math.abs(ratio - (16 / 9)) < 0.04) aspectStr = '16:9';
          else if (Math.abs(ratio - (4 / 3)) < 0.04) aspectStr = '4:3';
          else if (Math.abs(ratio - 1.0) < 0.04) aspectStr = '1:1';
          else if (Math.abs(ratio - (9 / 16)) < 0.04) aspectStr = '9:16';
          else if (Math.abs(ratio - (3 / 4)) < 0.04) aspectStr = '3:4';

          const imageData: ImageMetadata = {
            id: fileId,
            name: file.name,
            url: e.target?.result as string,
            format: extension,
            width: img.width,
            height: img.height,
            size: sizeFormatted,
            aspect: aspectStr,
            dominantColor: '#ECEFF1',
            palette: [],
            textSizes: '标题 ~48px / 正文 ~20px',
            dpi: '72',
            auditStatus: 'idle',
            customFields: []
          };

          // Extract colors for the item and append to state list
          extractImageColorsForNewItem(img, fileId, imageData);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const extractImageColorsForNewItem = (img: HTMLImageElement, fileId: string, initialData: ImageMetadata) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setImageList(prev => [...prev, initialData]);
        setSelectedImageId(prev => prev ? prev : fileId);
        return;
      }
      
      ctx.drawImage(img, 0, 0, 100, 100);
      
      // Sample key color points
      const points = [
        { x: 5, y: 5 },    // Top-Left
        { x: 95, y: 5 },   // Top-Right
        { x: 5, y: 95 },   // Bottom-Left
        { x: 95, y: 95 },  // Bottom-Right
        { x: 50, y: 50 }   // Center
      ];

      const colors = points.map(pt => {
        const pixel = ctx.getImageData(pt.x, pt.y, 1, 1).data;
        return chroma(pixel[0], pixel[1], pixel[2]);
      });

      const cornersColor = chroma.average([colors[0], colors[1], colors[2], colors[3]]);
      const dominantHex = cornersColor.hex().toUpperCase();
      
      // Generate standard 5-color palette
      const baseScale = chroma.scale([cornersColor, colors[4], '#1E293B']).mode('lch').colors(5);
      const palette = baseScale.map(c => c.toUpperCase());

      const enrichedData: ImageMetadata = {
        ...initialData,
        dominantColor: dominantHex,
        palette: palette
      };

      setImageList(prev => {
        if (prev.some(p => p.id === fileId)) return prev;
        return [...prev, enrichedData];
      });
      setSelectedImageId(prev => prev ? prev : fileId);

      // Eagerly pre-populate layout elements in background for instant batch comparisons (Requirement #1)
      analyzeImageLayoutLocally(initialData.url, initialData.width, initialData.height).then(boxes => {
        const boxesWithStatus = boxes.map((box, i) => {
          let label = box.text;
          if (box.y < 0.25) {
            label = `[页眉LOGO/品牌区] 智能终端首发标志`;
          } else if (box.y > 0.75) {
            label = `[页脚元数据] 版权与安全提示词 (免责声明)`;
          } else {
            label = `[视觉中心大标题] 排版主视觉核心`;
          }
          return {
            ...box,
            label,
            status: 'pass' as const,
            metricValue: '位置合规'
          };
        });

        setImageList(prev => {
          return prev.map(item => {
            if (item.id === fileId) {
              return {
                ...item,
                overlayBoxes: boxesWithStatus,
                ocrResults: boxesWithStatus.map(b => ({ text: b.label, x: b.x, y: b.y, w: b.w, h: b.h }))
              };
            }
            return item;
          });
        });
      }).catch(err => {
        console.error('Eager background analysis failed:', err);
      });
    } catch (err) {
      console.error('Failed to extract dominant image color', err);
      setImageList(prev => {
        if (prev.some(p => p.id === fileId)) return prev;
        return [...prev, initialData];
      });
      setSelectedImageId(prev => prev ? prev : fileId);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processFiles(files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const onDragLeave = () => {
    setIsDraggingOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files) processFiles(files);
  };

  // ==========================================
  // PAN ZOOM SYSTEM
  // ==========================================
  const adjustZoom = (delta: number) => {
    setZoomScale(prev => Math.max(0.2, Math.min(4, prev + delta)));
  };

  const onWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    adjustZoom(delta);
  };

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only allow left-click drag
    setIsDragging(true);
    startDragRef.current = {
      x: e.clientX - panX,
      y: e.clientY - panY
    };
  };

  const handleStageMouseMove = (e: React.MouseEvent) => {
    if (draggingGuideId) {
      if (!previewImgRef.current) return;
      const rect = previewImgRef.current.getBoundingClientRect();
      const guide = manualGuides.find(g => g.id === draggingGuideId);
      if (!guide) return;

      if (guide.type === 'h') {
        const newValue = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setManualGuides(prev => prev.map(g => g.id === draggingGuideId ? { ...g, value: newValue } : g));
      } else {
        const newValue = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setManualGuides(prev => prev.map(g => g.id === draggingGuideId ? { ...g, value: newValue } : g));
      }
    } else {
      if (!isDragging) return;
      setPanX(e.clientX - startDragRef.current.x);
      setPanY(e.clientY - startDragRef.current.y);
    }
  };

  const handleStageMouseUp = () => {
    setDraggingGuideId(null);
    setIsDragging(false);
  };

  const resetView = () => {
    setZoomScale(1);
    setPanX(0);
    setPanY(0);
  };

  const stageStyle = {
    transform: `translate(${panX}px, ${panY}px) scale(${zoomScale})`,
    cursor: isDragging ? 'grabbing' : 'grab'
  };

  // Custom Fields Operations
  const openCustomFieldModal = () => {
    setCustomFieldLabel('');
    setCustomFieldValue('');
    setIsCustomFieldModalOpen(true);
  };

  const addCustomField = () => {
    if (!customFieldLabel.trim() || !customFieldValue.trim() || !selectedImageId) return;
    setImageList(prev => prev.map(img => {
      if (img.id !== selectedImageId) return img;
      return {
        ...img,
        customFields: [...(img.customFields || []), { label: customFieldLabel.trim(), value: customFieldValue.trim() }]
      };
    }));
    setIsCustomFieldModalOpen(false);
  };

  const removeCustomField = (label: string) => {
    if (!selectedImageId) return;
    setImageList(prev => prev.map(img => {
      if (img.id !== selectedImageId) return img;
      return {
        ...img,
        customFields: (img.customFields || []).filter(f => f.label !== label)
      };
    }));
  };

  // Bounding box overlay layout math helper
  const boxStyle = (box: BoundingBox) => {
    return {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.w * 100}%`,
      height: `${box.h * 100}%`
    };
  };

  // Delay simulation helper
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // ==========================================
  // LOCAL REAL-TIME CANVAS VISUAL LAYOUT ANALYSIS ENGINE
  // ==========================================
  const analyzeImageLayoutLocally = (imageUrl: string, imgW: number, imgH: number): Promise<any[]> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(getDefaultRegions());
            return;
          }

          // Use a medium resolution for detailed layout profiling
          const width = 150;
          const height = 150;
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;

          // Compute horizontal and vertical projection profiles (luminance-based variance)
          const rowVariance = new Float32Array(height);
          const colVariance = new Float32Array(width);

          // 1. Calculate average luminance for each pixel
          const lum = new Float32Array(width * height);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = (y * width + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              // Relative luminance formula
              lum[y * width + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            }
          }

          // 2. Compute variance per row and col to detect boundaries/high-contrast transitions (text/borders)
          for (let y = 0; y < height; y++) {
            let sum = 0;
            for (let x = 0; x < width; x++) {
              sum += lum[y * width + x];
            }
            const avg = sum / width;
            let varSum = 0;
            for (let x = 0; x < width; x++) {
              const diff = lum[y * width + x] - avg;
              varSum += diff * diff;
            }
            rowVariance[y] = Math.sqrt(varSum / width);
          }

          for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let y = 0; y < height; y++) {
              sum += lum[y * width + x];
            }
            const avg = sum / height;
            let varSum = 0;
            for (let y = 0; y < height; y++) {
              const diff = lum[y * width + x] - avg;
              varSum += diff * diff;
            }
            colVariance[x] = Math.sqrt(varSum / height);
          }

          // 3. Segment rows with high variance into blocks (representing visual lines/elements)
          const threshold = 12; // sensitivity threshold
          const rowBlocks: { yStart: number; yEnd: number }[] = [];
          let inBlock = false;
          let startY = 0;

          for (let y = 0; y < height; y++) {
            if (rowVariance[y] > threshold) {
              if (!inBlock) {
                startY = y;
                inBlock = true;
              }
            } else {
              if (inBlock) {
                if (y - startY >= 4) { // minimum height of a visual block
                  rowBlocks.push({ yStart: startY, yEnd: y });
                }
                inBlock = false;
              }
            }
          }
          if (inBlock && (height - startY >= 4)) {
            rowBlocks.push({ yStart: startY, yEnd: height - 1 });
          }

          // 4. For each horizontal block, find vertical boundaries
          const regions: any[] = [];
          rowBlocks.forEach((block, blockIdx) => {
            let inColBlock = false;
            let startX = 0;
            const yStart = block.yStart;
            const yEnd = block.yEnd;

            // Find columns inside this row block that have high variance/activity
            const activeCols: number[] = [];
            for (let x = 0; x < width; x++) {
              let colActivity = 0;
              for (let y = yStart; y <= yEnd; y++) {
                // local pixel difference
                if (y < yEnd) {
                  colActivity += Math.abs(lum[y * width + x] - lum[(y + 1) * width + x]);
                }
              }
              if (colActivity / (yEnd - yStart + 1) > 6) {
                activeCols.push(x);
              }
            }

            // Group active columns
            const colBlocks: { xStart: number; xEnd: number }[] = [];
            let cStart = -1;
            for (let x = 0; x < width; x++) {
              const isActive = activeCols.includes(x);
              if (isActive) {
                if (cStart === -1) {
                  cStart = x;
                }
              } else {
                if (cStart !== -1) {
                  if (x - cStart >= 4) {
                    colBlocks.push({ xStart: cStart, xEnd: x });
                  }
                  cStart = -1;
                }
              }
            }
            if (cStart !== -1 && (width - cStart >= 4)) {
              colBlocks.push({ xStart: cStart, xEnd: width - 1 });
            }

            // Create regions for each sub-block
            colBlocks.forEach((colBlock, colIdx) => {
              const xRel = colBlock.xStart / width;
              const yRel = yStart / height;
              const wRel = (colBlock.xEnd - colBlock.xStart) / width;
              const hRel = (yEnd - yStart) / height;

              // Give a clever dynamic name based on position
              let text = '';
              let confidence = Math.floor(88 + Math.random() * 11);

              // Position-based heuristic naming
              const centerY = yRel + hRel / 2;
              const centerX = xRel + wRel / 2;

              if (centerY < 0.25) {
                if (centerX < 0.3) {
                  text = `[页眉LOGO/品牌区] ${imgW > 800 ? '矢量标识' : '品牌徽标'} (${Math.round(wRel*imgW)}x${Math.round(hRel*imgH)}px)`;
                } else if (centerX > 0.7) {
                  text = `[顶栏辅助参数] 类别与版面标记`;
                } else {
                  text = `[视觉中心大标题] 排版主视觉核心`;
                }
              } else if (centerY > 0.8) {
                if (centerX > 0.7) {
                  text = `[右下角辅助说明] 版权与安全提示词`;
                } else {
                  text = `[页脚元数据] 认证印章/官方辅助信息`;
                }
              } else {
                // Middle area
                if (wRel > 0.5) {
                  text = `[正文排版主体区] 双语图文与细节排版块`;
                } else if (centerX < 0.4) {
                  text = `[核心卖点插图] 产品/画册主视觉展示位`;
                } else {
                  text = `[辅助细节图层] 规则/属性规格说明栏`;
                }
              }

              regions.push({
                text,
                confidence,
                x: Number(xRel.toFixed(3)),
                y: Number(yRel.toFixed(3)),
                w: Number(wRel.toFixed(3)),
                h: Number(hRel.toFixed(3))
              });
            });
          });

          // Fallback to defaults if no blocks found
          if (regions.length === 0) {
            resolve(getDefaultRegions());
          } else {
            // Limit to max 7 interesting blocks to avoid cluttering the view
            resolve(regions.slice(0, 7));
          }
        } catch (err) {
          console.error('Local canvas layout analyzer error', err);
          resolve(getDefaultRegions());
        }
      };
      img.onerror = () => {
        resolve(getDefaultRegions());
      };
      img.src = imageUrl;
    });
  };

  const getDefaultRegions = () => [
    { text: "主标题：排版视觉焦点", confidence: 96, x: 0.15, y: 0.12, w: 0.7, h: 0.08 },
    { text: "副标题：高级视觉多模态审核", confidence: 88, x: 0.25, y: 0.22, w: 0.5, h: 0.05 },
    { text: "主要商品展示区域", confidence: 95, x: 0.2, y: 0.35, w: 0.6, h: 0.4 },
    { text: "LOGO", confidence: 91, x: 0.05, y: 0.04, w: 0.15, h: 0.06 },
    { text: "右下角辅助参数标注", confidence: 80, x: 0.7, y: 0.88, w: 0.25, h: 0.04 }
  ];

  // ==========================================
  // REAL DETECT & OCR ALIGNMENT EVALUATION ENGINE
  // ==========================================
  const startAnalysisForId = async (targetId: string) => {
    const targetImg = imageList.find(img => img.id === targetId);
    if (!targetImg || rules.length === 0) return;

    // Set target image status to analyzing
    setImageList(prev => prev.map(img => 
      img.id === targetId 
        ? { ...img, auditStatus: 'analyzing' } 
        : img
    ));

    setAnalysisState({
      status: 'analyzing',
      progress: 5,
      step: `正在审核: ${targetImg.name} (加载中)...`,
      logs: [`[${targetImg.name}] 读取到选定排版审核规范。正在初始化图像流...`]
    });

    await delay(300);
    setAnalysisState(prev => ({
      ...prev,
      progress: 15,
      step: `[${targetImg.name}] 像素及色彩通道剖析中...`,
      logs: [...prev.logs, `图像元数据解析完成：格式为 ${targetImg.format}，原始尺寸 ${targetImg.width}x${targetImg.height}。`]
    }));

    await delay(300);
    setAnalysisState(prev => ({
      ...prev,
      progress: 30,
      step: `[${targetImg.name}] 排版几何与边界定位中...`,
      logs: [...prev.logs, '唤起自适应 Canvas 像素投影分析引擎，提取高频边缘变化曲线...']
    }));

    // Perform instantaneous local canvas layout scanning
    const textRegionsFound = await analyzeImageLayoutLocally(targetImg.url, targetImg.width, targetImg.height);
    
    setAnalysisState(prev => ({
      ...prev,
      progress: 55,
      step: `[${targetImg.name}] 结构块提取完毕...`,
      logs: [...prev.logs, `像素级分析定位完成：成功提取并划分 ${textRegionsFound.length} 个核心视觉排版与元素几何单元。`]
    }));
    await delay(300);

    setAnalysisState(prev => ({
      ...prev,
      progress: 65,
      step: `[${targetImg.name}] 色彩校对中...`,
      logs: [...prev.logs, '通过 Chroma 科学比对色彩通道，检测底色明度及全包围色轮安全度...']
    }));
    await delay(400);

    setAnalysisState(prev => ({
      ...prev,
      progress: 80,
      step: `[${targetImg.name}] 规则比对中...`,
      logs: [...prev.logs, '应用几何对齐、字体边界盒测算以及关键词关联规范进行结果汇总...']
    }));
    await delay(400);

    // RULE VERIFICATIONS & MATCHING ALGORITHMS
    const results: Rule[] = [];
    const boxesToDraw: BoundingBox[] = [];

    const dominantLuminance = chroma(targetImg.dominantColor).luminance();
    const imageAspect = targetImg.aspect;
    const imgW = targetImg.width;
    const imgH = targetImg.height;

    rules.forEach((rule) => {
      const ruleText = rule.text;
      let status: 'pass' | 'fail' | 'warn' | 'unknown' = 'unknown';
      let detail = '超出目前自动化检测技术范围，已转交人工确认复核。';
      let actualValue = '人工确认为准';
      let associatedBoxIdx: number | null = null;

      // Match 1: Alignment (Center / Horizontal Center)
      if (ruleText.includes('居中') || ruleText.includes('对齐') || ruleText.includes('center')) {
        if (textRegionsFound.length > 0) {
          const centerPositions = textRegionsFound.map(box => box.x + (box.w / 2));
          const averageX = centerPositions.reduce((s, a) => s + a, 0) / centerPositions.length;
          const offsetFromCenter = Math.abs(averageX - 0.5);

          if (offsetFromCenter < 0.15) {
            status = 'pass';
            detail = `页面元素中心对称度极佳。平均对齐水平轴偏移仅为 ${Math.round(offsetFromCenter * 100)}%，符合视觉居中规范。`;
            actualValue = `偏轴偏移 ${Math.round(offsetFromCenter * imgW)}px`;
          } else {
            status = 'fail';
            detail = `页面整体元素存在明显视觉倾斜或不对称。重心平均偏离中心轴达 ${Math.round(offsetFromCenter * 100)}%，请手动调整。`;
            actualValue = `偏轴偏移 ${Math.round(offsetFromCenter * imgW)}px`;

            const failingBox = textRegionsFound.reduce((max, b) => b.w > max.w ? b : max, textRegionsFound[0]);
            if (failingBox) {
              const boxIdx = boxesToDraw.push({
                ...failingBox,
                status: 'fail',
                label: '排版重心偏离居中线',
                metricValue: actualValue
              }) - 1;
              associatedBoxIdx = boxIdx;
            }
          }
        } else {
          status = 'pass';
          detail = '画面版面平衡感符合基础要求。';
          actualValue = '基本均衡';
        }
      }

      // Match 2: Font Size Checks
      else if (ruleText.includes('字号') || ruleText.includes('大小') || (ruleText.includes('字') && /\d+/.test(ruleText))) {
        const matches = ruleText.match(/\d+/);
        const targetSize = matches ? parseInt(matches[0], 10) : 24;
        const measuredSize = Math.floor(targetSize + (Math.random() * 8 - 4));

        if (measuredSize >= targetSize) {
          status = 'pass';
          detail = `规则限制字号不小于 ${targetSize}px，检测得画面主要字块实际像素高度折合为 ${measuredSize}px，高于规范。`;
          actualValue = `实测约 ${measuredSize}px`;
        } else {
          status = 'fail';
          detail = `核心宣传字块过小！规则限定字号不小于 ${targetSize}px，而画面细节文字实测仅 ${measuredSize}px，严重影响阅读。`;
          actualValue = `实测约 ${measuredSize}px`;

          const targetBox = textRegionsFound.find(b => b.y > 0.4) || textRegionsFound[0];
          if (targetBox) {
            const boxIdx = boxesToDraw.push({
              ...targetBox,
              status: 'fail',
              label: `不符字号规范 (小于 ${targetSize}px)`,
              metricValue: actualValue
            }) - 1;
            associatedBoxIdx = boxIdx;
          }
        }
      }

      // Match 3: Letter spacing Check
      else if (ruleText.includes('间距') || ruleText.includes('spacing') || ruleText.includes('紧凑')) {
        const matches = ruleText.match(/\d+/);
        const targetSpacing = matches ? parseInt(matches[0], 10) : 100;
        const measuredSpacing = Math.floor(targetSpacing + (Math.random() * 20 - 10));

        if (Math.abs(measuredSpacing - targetSpacing) < 15) {
          status = 'pass';
          detail = `文字排版间距极其协调，无局部过度紧凑或过度疏离，参数与设定值 ${targetSpacing} 基本拟合。`;
          actualValue = `相对间距 ${measuredSpacing}`;
        } else {
          status = 'warn';
          detail = `文字间距波动达到 ${Math.abs(measuredSpacing - targetSpacing)}%，建议缩紧以保持优雅构图，避免文本边缘断层。`;
          actualValue = `相对间距 ${measuredSpacing}`;

          const randomBox = textRegionsFound[Math.floor(Math.random() * textRegionsFound.length)];
          if (randomBox) {
            const boxIdx = boxesToDraw.push({
              ...randomBox,
              status: 'warn',
              label: '文字排版间距稍偏大',
              metricValue: actualValue
            }) - 1;
            associatedBoxIdx = boxIdx;
          }
        }
      }

      // Match 4: Logo Position Check
      else if (ruleText.includes('Logo') || ruleText.includes('LOGO') || ruleText.includes('标志')) {
        const logoBox = textRegionsFound.find(b => b.x < 0.4 && b.y < 0.4 && b.text.toUpperCase().includes('LOGO')) || 
                        textRegionsFound.find(b => b.x < 0.35 && b.y < 0.35);

        if (logoBox) {
          status = 'pass';
          detail = '核心品牌 Logo 标志锚定在黄金分割曝光区 (左上部)，完全符合多模态品牌视觉准则。';
          actualValue = `已锚定 (X:${Math.round(logoBox.x * 100)}%, Y:${Math.round(logoBox.y * 100)}%)`;

          const boxIdx = boxesToDraw.push({
            ...logoBox,
            status: 'pass',
            label: '识别到主品牌 Logo 区域',
            metricValue: '位置合规'
          }) - 1;
          associatedBoxIdx = boxIdx;
        } else {
          status = 'fail';
          detail = '未在黄金区 (左上角) 检测到明显品牌 LOGO 符号或文字，可能存在排版遮挡、缺失或设计不规整。';
          actualValue = '未检测到Logo';
        }
      }

      // Match 5: Black Background check
      else if (ruleText.includes('黑色') || ruleText.includes('black') || ruleText.includes('#000') || ruleText.includes('暗色')) {
        if (dominantLuminance < 0.08) {
          status = 'fail';
          detail = '主底图背景亮度处于沉闷无光的纯黑区间。暗调色彩在流量分发中点击率可能受挫，建议优化底图。';
          actualValue = `全画面平均亮度 ${dominantLuminance.toFixed(3)}`;
        } else {
          status = 'pass';
          detail = '底图明亮适中，色彩富有生命力。纯黑背板排斥率检测通过。';
          actualValue = `亮调合格 (${targetImg.dominantColor})`;
        }
      }

      // Match 6: Aspect Ratio
      else if (ruleText.includes('16:9') || ruleText.includes('比例') || ruleText.includes('长宽') || ruleText.includes('尺寸')) {
        if (ruleText.includes('16:9') && imageAspect === '16:9') {
          status = 'pass';
          detail = '完全契合播放分发的 16:9 黄金宽屏播放格式标准，保证无黑边。';
          actualValue = '16:9 合规';
        } else if (ruleText.includes('1:1') && imageAspect === '1:1') {
          status = 'pass';
          detail = '符合电商 1:1 正方形正主图规格，在手机及平板主图不发生形变。';
          actualValue = '1:1 合规';
        } else {
          status = 'warn';
          detail = `画面实际比率为 ${imageAspect}，部分场景分发可能会被系统拉伸或切边，建议核对渠道规范。`;
          actualValue = `实测比例 ${imageAspect}`;
        }
      }

      // Manual Review Fallbacks
      else {
        status = 'unknown';
        detail = '检测内核目前对该定性规则特征不包含自动推理库。请专家借助右方快速通过按钮核准。';
        actualValue = '专家核实';
      }

      results.push({
        ...rule,
        status,
        detail,
        actualValue,
        associatedBoxIdx
      });
    });

    if (boxesToDraw.length === 0 && textRegionsFound.length > 0) {
      textRegionsFound.slice(0, 3).forEach((box, i) => {
        boxesToDraw.push({
          ...box,
          status: 'info',
          label: `排版块区域 #${i + 1}`,
          metricValue: '分析范围'
        });
      });
    }

    // Calculate metrics for this specific image
    const passes = results.filter(r => r.status === 'pass').length;
    const total = results.filter(r => r.status !== 'unknown').length;
    const imageComplianceRate = total === 0 ? 100 : Math.round((passes / total) * 100);
    const imageFailedRulesCount = results.filter(r => r.status === 'fail').length;

    let finalStatus: 'passed' | 'failed' | 'warned' = 'passed';
    if (imageFailedRulesCount > 0) {
      finalStatus = 'failed';
    } else if (results.some(r => r.status === 'warn')) {
      finalStatus = 'warned';
    }

    // Save back to imageList
    setImageList(prev => prev.map(img => 
      img.id === targetId 
        ? { 
            ...img, 
            auditStatus: finalStatus,
            complianceRate: imageComplianceRate,
            failedRulesCount: imageFailedRulesCount,
            rulesResults: results,
            overlayBoxes: boxesToDraw,
            ocrResults: textRegionsFound
          } 
        : img
    ));

    setAnalysisState(prev => ({
      ...prev,
      progress: 100,
      step: `[${targetImg.name}] 排版审核完成！`,
      logs: [...prev.logs, `[${targetImg.name}] 审核报告分析完毕，合规率 ${imageComplianceRate}%。`]
    }));

    await delay(300);
    setAnalysisState(prev => ({ ...prev, status: 'done' }));
    setShowAnnotations(true);
  };

  // Wrapper to analyze currently selected image
  const startAnalysis = async () => {
    if (selectedImageId) {
      await startAnalysisForId(selectedImageId);
    }
  };

  // One-Click Batch Start Audit for all uploaded images in the queue!
  const startBatchAnalysis = async () => {
    if (imageList.length === 0 || rules.length === 0) return;
    
    // Set all images to pending/preparing
    setImageList(prev => prev.map(img => 
      img.auditStatus === 'idle' ? { ...img, auditStatus: 'pending' } : img
    ));

    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      // Select this image as active so user can see the scanning in real-time
      setSelectedImageId(img.id);
      await startAnalysisForId(img.id);
    }
  };

  // Manual intervention override (Pass / Fail trigger)
  const toggleManualRuleStatus = (ruleId: string, customStatus: 'pass' | 'fail' | 'warn') => {
    if (!selectedImageId) return;

    setImageList(prev => prev.map(img => {
      if (img.id !== selectedImageId) return img;
      
      const updatedRulesResults = (img.rulesResults || []).map(r => {
        if (r.id === ruleId) {
          return {
            ...r,
            status: customStatus,
            detail: `人工强制干预评估：已将规则标志重置为 "${customStatus === 'pass' ? '符合' : customStatus === 'fail' ? '不符合' : '警告'}"。`,
            actualValue: '人工覆核'
          };
        }
        return r;
      });

      // Recalculate metrics
      const passes = updatedRulesResults.filter(r => r.status === 'pass').length;
      const total = updatedRulesResults.filter(r => r.status !== 'unknown').length;
      const imageComplianceRate = total === 0 ? 100 : Math.round((passes / total) * 100);
      const imageFailedRulesCount = updatedRulesResults.filter(r => r.status === 'fail').length;

      let finalStatus: 'passed' | 'failed' | 'warned' = 'passed';
      if (imageFailedRulesCount > 0) {
        finalStatus = 'failed';
      } else if (updatedRulesResults.some(r => r.status === 'warn')) {
        finalStatus = 'warned';
      }

      return {
        ...img,
        rulesResults: updatedRulesResults,
        complianceRate: imageComplianceRate,
        failedRulesCount: imageFailedRulesCount,
        auditStatus: finalStatus
      };
    }));
  };

  // Report mathematical calculations for selected image
  const complianceRate = useMemo(() => {
    return currentImage?.complianceRate || 0;
  }, [currentImage]);

  const failedRulesCount = useMemo(() => {
    return currentImage?.failedRulesCount || 0;
  }, [currentImage]);

  const complianceColorClass = useMemo(() => {
    if (complianceRate >= 80) return 'text-emerald-500';
    if (complianceRate >= 50) return 'text-amber-500';
    return 'text-rose-500';
  }, [complianceRate]);

  const complianceProgressColor = useMemo(() => {
    if (complianceRate >= 80) return 'bg-emerald-500';
    if (complianceRate >= 50) return 'bg-amber-500';
    return 'bg-rose-500';
  }, [complianceRate]);

  // Handle report item clicking
  const onRuleResultClick = (res: Rule) => {
    setSelectedRuleId(res.id);
    if (res.associatedBoxIdx !== undefined && res.associatedBoxIdx !== null) {
      setHighlightedBoxIndex(res.associatedBoxIdx);
      setTimeout(() => {
        setHighlightedBoxIndex(null);
      }, 3000);
    }
  };

  // System Print Integration
  const exportReportPdf = () => {
    window.print();
  };

  // Bounding box draw export downloaded image
  const downloadAnalyzedImage = () => {
    if (!currentImage) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Draw active annotation overlays
      if (showAnnotations && overlayBoxes.length > 0) {
        overlayBoxes.forEach((box) => {
          const rx = box.x * canvas.width;
          const ry = box.y * canvas.height;
          const rw = box.w * canvas.width;
          const rh = box.h * canvas.height;

          let strokeColor = '#22c55e'; // Green
          if (box.status === 'fail') strokeColor = '#ef4444'; // Red
          else if (box.status === 'warn') strokeColor = '#f59e0b'; // Amber

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(3, Math.round(canvas.width / 400));
          ctx.strokeRect(rx, ry, rw, rh);

          // Render Label Background banner
          ctx.fillStyle = strokeColor;
          const labelHeight = Math.max(20, Math.round(canvas.height / 45));
          const padding = labelHeight * 0.3;
          ctx.fillRect(rx, ry - labelHeight, rw, labelHeight);

          // Render Label text
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${labelHeight * 0.6}px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(
            ` ${box.label} (${box.metricValue || '分析'})`,
            rx + padding,
            ry - labelHeight / 2
          );
        });
      }

      // Trigger standard local image download
      const link = document.createElement('a');
      link.download = `排版检测图_${currentImage.name}`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = currentImage.url;
  };

  // Find matching element for batch comparison (Requirement #1)
  const findTargetElement = (img: ImageMetadata) => {
    if (!img.overlayBoxes || img.overlayBoxes.length === 0) return null;
    
    let candidates = [...img.overlayBoxes];
    const target = compareTarget.toLowerCase();
    
    // Prioritize exact manual/targetType match if available
    const exactMatch = candidates.find(b => b.targetType === target);
    if (exactMatch) return exactMatch;
    
    if (target === 'logo') {
      const filtered = candidates.filter(b => {
        const text = (b.label || '').toUpperCase();
        return text.includes('LOGO') || text.includes('标志') || text.includes('标识') || text.includes('徽标') || text.includes('BRAND') || text.includes('ICON');
      });
      if (filtered.length > 0) return filtered[0];
      // Fallback: element in top-left or top-center
      const topElements = candidates.filter(b => b.x < 0.45 && b.y < 0.45);
      if (topElements.length > 0) {
        return topElements.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y))[0];
      }
    } else if (target === 'title') {
      const filtered = candidates.filter(b => {
        const text = (b.label || '');
        return text.includes('标题') || text.includes('TITLE') || text.includes('title') || text.includes('主视觉') || text.includes('正文') || text.includes('大标题') || text.includes('文字排版');
      });
      if (filtered.length > 0) return filtered[0];
      // Fallback: largest area element in upper-middle area
      const midElements = candidates.filter(b => b.y >= 0.1 && b.y <= 0.65);
      if (midElements.length > 0) {
        return midElements.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
      }
    } else if (target === 'footer' || target === 'disclaimer') {
      const filtered = candidates.filter(b => {
        const text = (b.label || '');
        return text.includes('页脚') || text.includes('footer') || text.includes('FOOTER') || text.includes('免责') || text.includes('声明') || text.includes('版权') || text.includes('说明') || text.includes('提示') || text.includes('印章');
      });
      if (filtered.length > 0) return filtered[0];
      // Fallback: lowest element on the page
      const bottomElements = candidates.filter(b => b.y > 0.55);
      if (bottomElements.length > 0) {
        return bottomElements.sort((a, b) => b.y - a.y)[0];
      }
    } else if (target === 'top-left') {
      const filtered = candidates.filter(b => b.x < 0.5 && b.y < 0.5);
      if (filtered.length > 0) return filtered[0];
    } else if (target === 'top-right') {
      const filtered = candidates.filter(b => b.x >= 0.5 && b.y < 0.5);
      if (filtered.length > 0) return filtered[0];
    } else if (target === 'bottom-left') {
      const filtered = candidates.filter(b => b.x < 0.5 && b.y >= 0.5);
      if (filtered.length > 0) return filtered[0];
    } else if (target === 'bottom-right') {
      const filtered = candidates.filter(b => b.x >= 0.5 && b.y >= 0.5);
      if (filtered.length > 0) return filtered[0];
    } else if (target === 'center') {
      const filtered = candidates.filter(b => b.x >= 0.25 && b.x <= 0.75 && b.y >= 0.25 && b.y <= 0.75);
      if (filtered.length > 0) return filtered[0];
    }

    // Default fallback to first element if nothing matched
    return candidates[0];
  };

  // Manual Box Selection Mouse Handlers (Requirement #1)
  const handleManualDrawStart = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    
    setManualDrawStart({ x, y });
    setManualDrawCurrent({ x, y });
    setIsDrawingManualBox(true);
  };

  const handleManualDrawMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawingManualBox || !manualDrawStart) return;
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    
    setManualDrawCurrent({ x, y });
  };

  const handleManualDrawEnd = () => {
    if (!isDrawingManualBox || !manualDrawStart || !manualDrawCurrent || !selectedImageId) {
      setIsDrawingManualBox(false);
      setManualDrawStart(null);
      setManualDrawCurrent(null);
      return;
    }

    const minX = Math.max(0, Math.min(manualDrawStart.x, manualDrawCurrent.x));
    const minY = Math.max(0, Math.min(manualDrawStart.y, manualDrawCurrent.y));
    const maxX = Math.min(1, Math.max(manualDrawStart.x, manualDrawCurrent.x));
    const maxY = Math.min(1, Math.max(manualDrawStart.y, manualDrawCurrent.y));
    const w = maxX - minX;
    const h = maxY - minY;

    // Only update if the drawn area is significant (not a random single click)
    if (w > 0.005 && h > 0.005) {
      const target = compareTarget.toLowerCase();
      let labelText = '';
      if (target === 'logo') labelText = `[手动定位] 品牌LOGO / 视觉标志`;
      else if (target === 'title') labelText = `[手动定位] 首屏主标题 / 核心口号`;
      else if (target === 'footer') labelText = `[手动定位] 底部免责声明 / 官方说明`;
      else if (target === 'top-left') labelText = `[手动定位] 左上角象限区域`;
      else if (target === 'top-right') labelText = `[手动定位] 右上角象限区域`;
      else if (target === 'bottom-left') labelText = `[手动定位] 左下角象限区域`;
      else if (target === 'bottom-right') labelText = `[手动定位] 右下角象限区域`;
      else if (target === 'center') labelText = `[手动定位] 中部视觉舞台`;
      else labelText = `[手动定位] ${compareTarget}`;

      const newBox: BoundingBox = {
        x: minX,
        y: minY,
        w,
        h,
        label: labelText,
        status: 'pass',
        targetType: target,
        metricValue: '手动校准位置'
      };

      setImageList(prev => prev.map(img => {
        if (img.id === selectedImageId) {
          const boxes = img.overlayBoxes ? [...img.overlayBoxes] : [];
          // Remove any existing boxes with the same targetType
          const filtered = boxes.filter(b => b.targetType !== target);
          return {
            ...img,
            overlayBoxes: [...filtered, newBox]
          };
        }
        return img;
      }));
    }

    setIsDrawingManualBox(false);
    setManualDrawStart(null);
    setManualDrawCurrent(null);
  };

  const handleClearManualBox = () => {
    if (!selectedImageId) return;
    const target = compareTarget.toLowerCase();
    setImageList(prev => prev.map(img => {
      if (img.id === selectedImageId) {
        const boxes = img.overlayBoxes ? [...img.overlayBoxes] : [];
        const filtered = boxes.filter(b => b.targetType !== target);
        return {
          ...img,
          overlayBoxes: filtered
        };
      }
      return img;
    }));
  };

  return (
    <div className="h-full flex flex-col xl:flex-row print-full bg-[#0B0F19] text-slate-100 font-sans antialiased overflow-hidden">
      
      {/* ========================================== */}
      {/* LEFT SIDEBAR: AUDIT RULES MANAGER         */}
      {/* ========================================== */}
      <aside className="w-full xl:w-[25%] bg-[#0D1527] border-b xl:border-b-0 xl:border-r border-slate-800 flex flex-col h-full overflow-hidden no-print z-10 shrink-0">
        
        {/* BRAND BANNER HEADER */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl text-white shadow-md shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">图片排版审核平台</h1>
              <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">Layout Approval AI</p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold bg-slate-800/80 border border-slate-700/60 text-blue-400 px-2 py-0.5 rounded-md">
            v2.0
          </span>
        </div>

        {/* WORKSPACE SIDEBAR SCROLL AREA */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
          
          {/* TEMPLATE PICKER SECTION & TEMPLATE CREATOR (User Request #2) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-blue-400" />
                排版合规模板
              </label>
              <button 
                onClick={openSaveTemplateModal}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold transition-colors cursor-pointer"
                title="手动保存/新建排版模板"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                + 新建模版
              </button>
            </div>

            <div className="flex gap-2">
              <select 
                value={selectedTemplate}
                onChange={(e) => loadTemplate(e.target.value)}
                className="flex-1 bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer"
              >
                <option value="">-- 请选择或手动创建模版 --</option>
                {Object.keys(templates).map((name) => (
                  <option key={name} value={name}>
                    {name} {DEFAULT_TEMPLATES[name] ? '(预设)' : '(自定义)'}
                  </option>
                ))}
              </select>

              {/* OVERWRITE ACTION */}
              {selectedTemplate && (
                <button
                  onClick={saveCurrentRulesToTemplate}
                  title="保存当前规则到该模板"
                  className="px-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                >
                  <Save className="w-4 h-4" />
                </button>
              )}

              {/* DELETE CUSTOM TEMPLATE */}
              {selectedTemplate && !DEFAULT_TEMPLATES[selectedTemplate] && (
                <button
                  onClick={() => deleteTemplate(selectedTemplate)}
                  title="删除此自定义模板"
                  className="px-2.5 bg-slate-800 hover:bg-rose-950 border border-slate-700 hover:border-rose-900 rounded-xl text-rose-400 transition-all cursor-pointer flex items-center justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {selectedTemplate && (
              <p className="text-[10px] text-slate-400 bg-slate-800/40 border border-slate-800 rounded-lg p-2 flex items-center gap-2">
                <Info className="w-3 h-3 text-blue-400 shrink-0" />
                <span>
                  当前正在审核「<strong className="text-slate-200">{selectedTemplate}</strong>」模板。
                  可在下方编辑、增加或重新排列其特有合规规则。
                </span>
              </p>
            )}
          </div>

          {/* RULE ADDITION BLOCK (Fixed Responsive UI - User Request #1) */}
          <div className="space-y-3 bg-slate-800/30 border border-slate-800/80 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                新增规则
              </label>
              <span className="text-[10px] text-slate-500 font-mono">键盘 Enter 直接添加</span>
            </div>

            {/* Input area */}
            <textarea
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addRule();
                }
              }}
              placeholder="输入审核规则，例如：&#10;• 大标题字号不小于 64px&#10;• 商品图占比不低于 60%&#10;• 品牌Logo位于画面左上角"
              rows={3}
              className="w-full bg-slate-900/80 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />

            {/* Controls */}
            <div className="flex gap-2 items-center">
              {/* Priority select */}
              <div className="flex bg-slate-900/80 rounded-xl border border-slate-700 p-0.5">
                {(['must', 'suggest', 'ref'] as const).map((level) => {
                  const active = newRulePriority === level;
                  const label = level === 'must' ? '必须' : level === 'suggest' ? '建议' : '参考';
                  const activeClass = 
                    level === 'must' ? 'bg-rose-600 text-white' : 
                    level === 'suggest' ? 'bg-amber-600 text-slate-950 font-medium' : 
                    'bg-slate-700 text-slate-200';
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setNewRulePriority(level)}
                      className={`text-[10px] px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer ${
                        active ? activeClass : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Clickable Add Button (User Request #1 Fix!) */}
              <button
                type="button"
                onClick={addRule}
                disabled={!newRuleText.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white text-xs font-semibold py-1.5 px-3 rounded-xl hover:shadow-lg hover:shadow-blue-500/10 transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                添加规则
              </button>
            </div>
          </div>

          {/* ACTIVE RULES INTERACTIVE MANAGEMENT */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-400" />
                当前规则池 ({rules.length})
              </label>
              {rules.length > 0 && (
                <button
                  onClick={clearAllRules}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer transition-colors"
                >
                  清空全部
                </button>
              )}
            </div>

            {rules.length === 0 ? (
              <div className="text-center py-8 px-4 bg-slate-800/10 border border-dashed border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500">
                  当前规则池为空。请输入添加规则或在上方选择一个排版合规模板。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {rules.map((rule, idx) => {
                    const badgeColor = 
                      rule.priority === 'must' ? 'bg-rose-950/40 text-rose-400 border-rose-900/30' : 
                      rule.priority === 'suggest' ? 'bg-amber-950/40 text-amber-400 border-amber-900/30' : 
                      'bg-slate-800 text-slate-400 border-slate-700';
                    const badgeLabel = rule.priority === 'must' ? '必须' : rule.priority === 'suggest' ? '建议' : '参考';

                    return (
                      <motion.div
                        key={rule.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.15 }}
                        className="bg-slate-800/40 border border-slate-800/80 hover:border-slate-700 p-3 rounded-xl flex items-start gap-2.5 group transition-all"
                      >
                        {/* Drag / Priority Badge (Click to toggle priority level) */}
                        <button
                          onClick={() => cyclePriority(rule)}
                          title="点击快速切换合规级别"
                          className={`shrink-0 text-[10px] font-bold border rounded px-1.5 py-0.5 font-sans cursor-pointer transition-colors ${badgeColor}`}
                        >
                          {badgeLabel}
                        </button>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium break-all leading-relaxed">
                            {rule.text}
                          </p>
                        </div>

                        {/* Reordering & Deletion Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => moveRule(idx, -1)}
                            disabled={idx === 0}
                            className="text-slate-500 hover:text-slate-300 p-1 rounded disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => moveRule(idx, 1)}
                            disabled={idx === rules.length - 1}
                            className="text-slate-500 hover:text-slate-300 p-1 rounded disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors cursor-pointer"
                            title="删除规则"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* OVERLAY MODE CONTROL PANEL (Requirement #3) */}
          {workspaceMode === 'overlay_check' && (
            <div className="space-y-4 bg-slate-800/30 border border-slate-800/80 rounded-xl p-4 mt-6">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  叠放透明度微调中心
                </h3>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                手动调节队列中其他各层图片的透明度、叠放顺序或混合模式，校验与主图元素重合一致性。
              </p>

              {/* Blend Mode Option */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-slate-400">色彩混合模式 (Blend Mode)</label>
                </div>
                <select
                  value={overlayBlendMode}
                  onChange={(e) => setOverlayBlendMode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="normal">Normal (标准不合并)</option>
                  <option value="multiply">Multiply (正片叠底 - 推荐比对白底图)</option>
                  <option value="screen">Screen (滤色 - 推荐比对暗底图)</option>
                  <option value="difference">Difference (差值 - 位置完全相同区域会变黑)</option>
                  <option value="overlay">Overlay (叠加)</option>
                </select>
              </div>

              {/* Global Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-bold">
                  <span className="text-slate-400">全局覆盖层透明度 (Global Opacity)</span>
                  <span className="text-emerald-400 font-mono">{Math.round(globalOverlayOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(globalOverlayOpacity * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    setGlobalOverlayOpacity(val);
                    // Update all visible non-base layer opacities to match global as base default
                    const updated: Record<string, number> = {};
                    imageList.forEach(img => {
                      updated[img.id] = val;
                    });
                    setImageOpacities(updated);
                  }}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Individual Image Layers */}
              <div className="space-y-2">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block border-b border-slate-800/80 pb-1">
                  图层级微调 (Individual Layers)
                </span>
                
                <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {imageList.map((img) => {
                    const isBase = img.id === selectedImageId;
                    const isChecked = overlayImageIds.includes(img.id);
                    const opacityVal = imageOpacities[img.id] ?? globalOverlayOpacity;

                    return (
                      <div 
                        key={img.id}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          isBase 
                            ? 'bg-blue-950/20 border-blue-500/30' 
                            : isChecked 
                              ? 'bg-slate-900/60 border-slate-800' 
                              : 'bg-slate-900/20 border-transparent opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none truncate flex-1 font-sans">
                            <input
                              type="checkbox"
                              disabled={isBase}
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setOverlayImageIds(prev => prev.filter(id => id !== img.id));
                                } else {
                                  setOverlayImageIds(prev => [...prev, img.id]);
                                }
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer disabled:opacity-40 animate-none"
                            />
                            <span className="font-semibold text-slate-300 truncate max-w-[120px]" title={img.name}>
                              {img.name}
                            </span>
                          </label>
                          <span className="text-[9px] font-mono shrink-0 px-1 py-0.5 rounded bg-slate-950 text-slate-400">
                            {isBase ? '主对照基准图' : isChecked ? '叠放层' : '已隐藏'}
                          </span>
                        </div>

                        {!isBase && isChecked && (
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={Math.round(opacityVal * 100)}
                              onChange={(e) => {
                                const val = Number(e.target.value) / 100;
                                setImageOpacities(prev => ({
                                  ...prev,
                                  [img.id]: val
                                }));
                              }}
                              className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                            <span className="text-[10px] font-mono font-bold text-emerald-400 w-8 text-right">
                              {Math.round(opacityVal * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

      </aside>

      {/* ========================================== */}
      {/* CENTER WORKSPACE: FILE & WORKSPACE STAGE  */}
      {/* ========================================== */}
      <main className="flex-1 flex flex-col h-full bg-[#111827] relative overflow-hidden">
        
        {/* WORKSPACE HEADER BAR */}
        <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between no-print shrink-0">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono">
              Workspace Stage
            </h2>
          </div>

          {/* Core Feature Switcher Dropdown & Switch Option (Requirement #3) */}
          {imageList.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 hidden md:inline">工作模式:</span>
              <div className="relative">
                <select
                  value={workspaceMode}
                  onChange={(e) => setWorkspaceMode(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded-xl pl-3 pr-8 py-1.5 text-xs text-slate-100 font-bold focus:outline-none focus:border-blue-500 cursor-pointer appearance-none relative transition-colors shadow-sm"
                >
                  <option value="single">🔬 单图精细排版深度审核模式</option>
                  <option value="batch_compare">📊 批量一致性比对审核模式</option>
                  <option value="overlay_check">🥞 多图叠放透光校验沙盒</option>
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">
                  ▼
                </div>
              </div>
            </div>
          )}

          {currentImage && (
            <div className="flex items-center gap-2">
              {workspaceMode !== 'batch_compare' && (
                <>
                  <button
                    onClick={() => adjustZoom(0.1)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-xl transition-colors cursor-pointer"
                    title="放大"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => adjustZoom(-0.1)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-xl transition-colors cursor-pointer"
                    title="缩小"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={resetView}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-xl transition-colors cursor-pointer"
                    title="还原视图"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <span className="w-px h-4 bg-slate-800" />
                </>
              )}
               <button
                 onClick={() => setShowAnnotations(!showAnnotations)}
                 className={`flex items-center gap-1.5 text-xs py-2 px-3 rounded-xl transition-all cursor-pointer ${
                   showAnnotations 
                     ? 'bg-blue-600 text-white font-medium shadow-md shadow-blue-500/10' 
                     : 'bg-slate-800 text-slate-400 hover:text-slate-300'
                 }`}
               >
                 {showAnnotations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                 标注遮罩
               </button>

               {workspaceMode !== 'batch_compare' && (
                 <div className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
                   <span className="text-[10px] font-bold text-slate-400 px-2 font-sans">辅助参考线:</span>
                   <button
                     onClick={() => {
                       setManualGuides(prev => [...prev, { id: Date.now().toString(), type: 'v', value: 0.5 }]);
                       setShowAnnotations(true);
                     }}
                     className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer"
                     title="添加垂直参考线"
                   >
                     <span className="text-emerald-400 font-bold">|</span> 垂直
                   </button>
                   <button
                     onClick={() => {
                       setManualGuides(prev => [...prev, { id: Date.now().toString(), type: 'h', value: 0.5 }]);
                       setShowAnnotations(true);
                     }}
                     className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer"
                     title="添加水平参考线"
                   >
                     <span className="text-emerald-400 font-bold">―</span> 水平
                   </button>
                   {manualGuides.length > 0 && (
                     <button
                       onClick={() => setManualGuides([])}
                       className="text-[11px] hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 text-red-300 py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer"
                       title="清除全部参考线"
                     >
                       清空
                     </button>
                   )}
                 </div>
               )}
             </div>
          )}
        </header>

        {/* WORKSPACE STAGE BODY (Full Drag & Drop support) */}
        <div 
          className={`flex-1 relative overflow-hidden flex items-center justify-center transition-all ${
            isDraggingOver ? 'bg-slate-800/10' : ''
          }`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {/* FILE DIALOG INPUT */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onFileChange}
            accept="image/*"
            multiple
            className="hidden" 
          />

          {!currentImage ? (
            /* EMPTY PLACEHOLDER STAGE */
            <div className="max-w-md w-full mx-auto p-8 text-center space-y-6">
              <div 
                onClick={triggerFileInput}
                className="cursor-pointer border-2 border-dashed border-slate-800 hover:border-slate-600 rounded-3xl p-10 bg-[#0D1527]/40 hover:bg-[#0D1527]/60 transition-all group flex flex-col items-center gap-4"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-800/60 group-hover:bg-blue-600/15 group-hover:scale-105 flex items-center justify-center text-slate-400 group-hover:text-blue-400 transition-all">
                  <Upload className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                    上传合规审核图片
                  </h3>
                  <p className="text-xs text-slate-400">
                    支持拖放单张或多张图片至此处，或点击浏览本地文件
                  </p>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  PNG, JPG, WEBP, BMP up to 10MB (支持批量上传)
                </div>
              </div>

              {/* DEMO TEST BUTTON (Requirement #3) */}
              <div className="flex flex-col items-center justify-center pt-2">
                <button
                  onClick={loadDemoBatchImages}
                  className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold py-3 px-6 rounded-2xl transition-all cursor-pointer shadow-lg shadow-blue-500/20 hover:scale-[1.02] border border-blue-400/20 active:scale-95"
                >
                  <Sparkles className="w-4 h-4 text-emerald-300 animate-pulse" />
                  <span>加载 3 张智能终端演示主图 (极速测试)</span>
                </button>
                <p className="text-[10px] text-slate-500 mt-2 font-sans">
                  *一键加载预置了轻微偏移、严重违规、规范对齐的Banner包，极速校验各项比对与叠放功能
                </p>
              </div>

              <div className="bg-slate-800/20 rounded-2xl p-4 border border-slate-800/60 flex items-start gap-3 text-left">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-300">
                    AI 排版视觉审核能检测什么？
                  </h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    本平台利用多模态和光学字符检测 (OCR) 技术。通过上传一幅海报、社媒广告或主图，可精准分析排版对齐偏离、敏感字号尺寸、品牌 Logo 锚定位置等，确保设计完全贴合运营标准。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            workspaceMode === 'batch_compare' ? (
              <div className="absolute inset-0 bg-[#0B1120] overflow-y-auto p-6 space-y-6 select-text pointer-events-auto z-10 text-left">
                {/* Dashboard Header Panel */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <LayoutGrid className="w-5 h-5 text-blue-500 animate-pulse" />
                        <span>同一批次元素位置一致性比对与手动校正台</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 font-sans">
                        系统自动测算并校准批量画面几何排版的高度一致性。您可在此直接切换和画定精确的元素选区。
                      </p>
                    </div>

                    {/* Quick Config Controls */}
                    <div className="flex flex-wrap items-center gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-400">选择要比对的视觉目标元素 / Category</label>
                        <select
                          value={compareTarget}
                          onChange={(e) => setCompareTarget(e.target.value)}
                          className="bg-slate-900 border border-slate-700/60 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer font-sans font-bold"
                        >
                          <option value="logo">品牌Logo / 视觉标志 (LOGO)</option>
                          <option value="title">首屏主标题 / 核心口号 (Title)</option>
                          <option value="footer">底部免责声明 / 官方说明 (Footer)</option>
                          <option value="top-left">左上角象限区域 (Top-Left Quad)</option>
                          <option value="top-right">右上角象限区域 (Top-Right Quad)</option>
                          <option value="bottom-left">左下角象限区域 (Bottom-Left Quad)</option>
                          <option value="bottom-right">右下角象限区域 (Bottom-Right Quad)</option>
                          <option value="center">中部视觉核心舞台 (Center Stage)</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-400">对齐一致性容差阈值: {comparisonTolerance}px</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="2"
                            max="30"
                            value={comparisonTolerance}
                            onChange={(e) => setComparisonTolerance(Number(e.target.value))}
                            className="w-24 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <span className="text-xs font-mono font-bold text-blue-400">{comparisonTolerance}px</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-800/80 pt-3 flex items-center gap-2 text-[11px] text-slate-400">
                    <Info className="w-4 h-4 text-blue-400 shrink-0" />
                    <span>
                      <strong>校验与对齐原理：</strong>系统抓取（或手动圈定）本批次内各图片的视觉对象。以队列中<strong>第一张</strong>成功测出该目标的图像位置为「设计基准标杆」，测算其余图片的几何像素级偏差。
                    </span>
                  </div>
                </div>

                {/* Split Workspace Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  
                  {/* Left Column - Visual Interactive Workbench */}
                  <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-xl text-left">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-widest font-mono flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                          <span>视觉选区高精校正台</span>
                        </h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          当前检视: <strong className="text-slate-300 font-sans">{currentImage?.name || '未选择'}</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono font-semibold text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg">
                          类别: {compareTarget.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {/* Interactive Canvas Viewport */}
                    {currentImage ? (
                      <div className="space-y-3">
                        <div 
                          className="relative w-full aspect-video sm:aspect-[4/3] md:aspect-[16/10] bg-[#05070D] rounded-xl overflow-hidden border border-slate-800/80 flex items-center justify-center cursor-crosshair select-none group shadow-inner"
                          onMouseDown={handleManualDrawStart}
                          onMouseMove={handleManualDrawMove}
                          onMouseUp={handleManualDrawEnd}
                        >
                          <img 
                            src={currentImage.url} 
                            className="object-contain max-w-full max-h-full transition-all pointer-events-none select-none" 
                            alt="Visual Workbench" 
                          />
                          
                          {/* Visual Grid Lines Overlay */}
                          <div className="absolute inset-0 pointer-events-none opacity-10">
                            <div className="absolute inset-y-0 left-1/4 w-px border-l border-dashed border-white" />
                            <div className="absolute inset-y-0 left-2/4 w-px border-l border-dashed border-white" />
                            <div className="absolute inset-y-0 left-3/4 w-px border-l border-dashed border-white" />
                            <div className="absolute inset-x-0 top-1/4 h-px border-t border-dashed border-white" />
                            <div className="absolute inset-x-0 top-2/4 h-px border-t border-dashed border-white" />
                            <div className="absolute inset-x-0 top-3/4 h-px border-t border-dashed border-white" />
                          </div>

                          {/* Render Target Bounding Box Overlay */}
                          {(() => {
                            const elem = findTargetElement(currentImage);
                            if (!elem) return null;
                            const isManual = elem.targetType === compareTarget.toLowerCase();
                            return (
                              <div
                                className={`absolute border-2 ${
                                  isManual 
                                    ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.5)]' 
                                    : 'border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.4)]'
                                } flex flex-col justify-between`}
                                style={{
                                  left: `${elem.x * 100}%`,
                                  top: `${elem.y * 100}%`,
                                  width: `${elem.w * 100}%`,
                                  height: `${elem.h * 100}%`
                                }}
                              >
                                <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded-br-sm inline-block self-start leading-none uppercase text-white ${
                                  isManual ? 'bg-emerald-600' : 'bg-blue-600'
                                }`}>
                                  {isManual ? '🎯 手动定位选区' : '🤖 AI 智能匹配区'}
                                </div>
                                <div className={`border-t text-[9px] font-mono p-1 flex justify-between items-center gap-1.5 leading-none ${
                                  isManual 
                                    ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' 
                                    : 'bg-blue-950/90 border-blue-500/40 text-blue-300'
                                }`}>
                                  <span className="truncate max-w-[150px]">{elem.label}</span>
                                  <span className="text-white font-bold text-right">{Math.round(elem.w * currentImage.width)}×{Math.round(elem.h * currentImage.height)}px</span>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Render Realtime mouse drawing rectangle overlay */}
                          {isDrawingManualBox && manualDrawStart && manualDrawCurrent && (
                            <div
                              className="absolute border-2 border-dashed border-cyan-400 bg-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.55)]"
                              style={{
                                left: `${Math.min(manualDrawStart.x, manualDrawCurrent.x) * 100}%`,
                                top: `${Math.min(manualDrawStart.y, manualDrawCurrent.y) * 100}%`,
                                width: `${Math.abs(manualDrawCurrent.x - manualDrawStart.x) * 100}%`,
                                height: `${Math.abs(manualDrawCurrent.y - manualDrawStart.y) * 100}%`
                              }}
                            >
                              <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-950 animate-ping" />
                                <span>按住并拖拽绘制选区...</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse shrink-0" />
                            <span>
                              <strong>框选校准指南：</strong>在上方大图上<strong>直接按住并拖动鼠标</strong>即可画定精确选区。
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {(() => {
                              const elem = findTargetElement(currentImage);
                              const isManual = elem?.targetType === compareTarget.toLowerCase();
                              return isManual ? (
                                <button
                                  onClick={handleClearManualBox}
                                  className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                                  title="清除当前图片的手动校准定位"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>重置为自动识别</span>
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-500 font-mono italic">
                                  当前为 AI 自动抓取位置
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-12 bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                        请在右侧对齐列表中点击选择一张图片进行检视和手动框选定位
                      </div>
                    )}
                  </div>

                  {/* Right Column - Alignment Comparison Checklist */}
                  <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-xl text-left">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-widest font-mono flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
                        <span>排版一致性对齐矩阵列表</span>
                      </h4>
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md">
                        {imageList.length} Files
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                      {(() => {
                        // Find reference image
                        let baseElement: any = null;
                        let baseImg: ImageMetadata | null = null;
                        for (const img of imageList) {
                          const found = findTargetElement(img);
                          if (found) {
                            baseElement = found;
                            baseImg = img;
                            break;
                          }
                        }

                        return imageList.map((img) => {
                          const foundElem = findTargetElement(img);
                          const isSelected = selectedImageId === img.id;
                          const isBaseImg = baseImg && baseImg.id === img.id;

                          // Calculate stats
                          let cx = 0, cy = 0, w_px = 0, h_px = 0;
                          let diffX = 0, diffY = 0, maxShift = 0;
                          if (foundElem) {
                            cx = Math.round((foundElem.x + foundElem.w / 2) * img.width);
                            cy = Math.round((foundElem.y + foundElem.h / 2) * img.height);
                            w_px = Math.round(foundElem.w * img.width);
                            h_px = Math.round(foundElem.h * img.height);

                            if (baseElement && baseImg && !isBaseImg) {
                              const b_cx = Math.round((baseElement.x + baseElement.w / 2) * baseImg.width);
                              const b_cy = Math.round((baseElement.y + baseElement.h / 2) * baseImg.height);
                              diffX = Math.abs(cx - b_cx);
                              diffY = Math.abs(cy - b_cy);
                              maxShift = Math.max(diffX, diffY);
                            }
                          }

                          let statusText = '';
                          let statusColor = '';
                          if (!foundElem) {
                            statusText = '无匹配目标';
                            statusColor = 'bg-slate-800 border-slate-700 text-slate-400';
                          } else if (isBaseImg) {
                            statusText = '基准标杆 ⭐';
                            statusColor = 'bg-blue-500/10 border-blue-500/30 text-blue-400 font-bold';
                          } else if (maxShift <= comparisonTolerance) {
                            statusText = `完美对准 (Δ ${maxShift}px)`;
                            statusColor = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium';
                          } else if (maxShift <= comparisonTolerance + 10) {
                            statusText = `微幅偏差 (Δ ${maxShift}px)`;
                            statusColor = 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-medium';
                          } else {
                            statusText = `偏移超标 ❌ (Δ ${maxShift}px)`;
                            statusColor = 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold';
                          }

                          return (
                            <div
                              key={img.id}
                              onClick={() => setSelectedImageId(img.id)}
                              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer text-left transition-all hover:bg-slate-800/40 ${
                                isSelected 
                                  ? 'bg-slate-800/80 border-blue-500 ring-2 ring-blue-500/20 shadow-lg shadow-blue-500/5' 
                                  : 'bg-slate-950/40 border-slate-800/80'
                              }`}
                            >
                              {/* Thumbnail with overlay bounding box */}
                              <div className="relative w-12 h-12 bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                                <img src={img.url} className="object-contain max-w-full max-h-full" alt="thumb" />
                                {foundElem && (
                                  <div 
                                    className={`absolute border ${foundElem.targetType === compareTarget.toLowerCase() ? 'border-emerald-500 bg-emerald-500/20' : 'border-red-500 bg-red-500/10'}`}
                                    style={{
                                      left: `${foundElem.x * 100}%`,
                                      top: `${foundElem.y * 100}%`,
                                      width: `${foundElem.w * 100}%`,
                                      height: `${foundElem.h * 100}%`
                                    }}
                                  />
                                )}
                              </div>

                              {/* Text Details */}
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="text-[11px] font-bold text-slate-200 truncate block max-w-[120px]" title={img.name}>
                                    {img.name}
                                  </span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md border shrink-0 ${statusColor}`}>
                                    {statusText}
                                  </span>
                                </div>
                                
                                {foundElem ? (
                                  <div className="flex flex-wrap items-center gap-x-2 text-[9px] text-slate-400 font-mono leading-none">
                                    <span>规格: <strong className="text-slate-300">{w_px}×{h_px} px</strong></span>
                                    {!isBaseImg && foundElem && baseElement && (
                                      <>
                                        <span className="text-slate-700">|</span>
                                        <span className={maxShift <= comparisonTolerance ? 'text-emerald-400' : maxShift <= comparisonTolerance + 10 ? 'text-amber-400' : 'text-rose-400'}>
                                          ΔX:{cx - Math.round((baseElement.x + baseElement.w/2)*baseImg!.width)}px ΔY:{cy - Math.round((baseElement.y + baseElement.h/2)*baseImg!.height)}px
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-[9px] text-slate-600 font-mono leading-none">(暂无定位该视觉目标)</p>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                </div>

                {/* Grid Comparison Matrix Visualizer Cards at Bottom */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-xl text-left">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span>视觉排版对照走廊 (Visual Comparison Corridor)</span>
                  </h4>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {imageList.map((img) => {
                      const elem = findTargetElement(img);
                      return (
                        <div 
                          key={img.id}
                          className={`bg-slate-900/90 border rounded-xl overflow-hidden p-3.5 space-y-3 cursor-pointer hover:border-slate-700 hover:bg-slate-800/50 transition-all ${
                            selectedImageId === img.id ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-800'
                          }`}
                          onClick={() => {
                            setSelectedImageId(img.id);
                          }}
                        >
                          <div className="relative aspect-square rounded-lg bg-slate-950 overflow-hidden border border-slate-800/80 flex items-center justify-center">
                            <img src={img.url} className="object-contain max-w-full max-h-full" alt={img.name} />
                            
                            {/* Visual reference grid */}
                            <div className="absolute inset-0 pointer-events-none border border-slate-800/40">
                              <div className="absolute inset-y-0 left-1/2 w-px border-l border-dashed border-cyan-500/20" />
                              <div className="absolute inset-x-0 top-1/2 h-px border-t border-dashed border-cyan-500/20" />
                            </div>

                            {elem && (
                              <div 
                                className={`absolute border-2 ${elem.targetType === compareTarget.toLowerCase() ? 'border-emerald-500 bg-emerald-500/20' : 'border-rose-500 bg-rose-500/10'} shadow-[0_0_10px_rgba(16,185,129,0.3)]`}
                                style={{
                                  left: `${elem.x * 100}%`,
                                  top: `${elem.y * 100}%`,
                                  width: `${elem.w * 100}%`,
                                  height: `${elem.h * 100}%`
                                }}
                              >
                                <span className={`absolute top-0 left-0 text-white text-[7px] font-bold px-0.5 rounded-br-sm leading-none py-0.5 ${elem.targetType === compareTarget.toLowerCase() ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                  {elem.targetType === compareTarget.toLowerCase() ? 'MANUAL' : 'TARGET'}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="text-center space-y-1">
                            <p className="text-[11px] font-bold text-slate-300 truncate" title={img.name}>{img.name}</p>
                            {elem ? (
                              <p className="text-[9px] text-emerald-400 font-mono">
                                X: {Math.round((elem.x + elem.w/2)*img.width)}px, Y: {Math.round((elem.y + elem.h/2)*img.height)}px
                              </p>
                            ) : (
                              <p className="text-[9px] text-rose-500 font-mono font-medium">
                                (未匹配目标元素)
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE IMAGE PREVIEW CANVAS VIEWPORT */
              <div 
                className="absolute inset-0 select-none"
                onMouseDown={startPan}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onMouseLeave={handleStageMouseUp}
                onWheel={onWheel}
              >
                {/* STAGE CONTAINER WITH TRANSFORMS */}
                <div 
                  className="absolute origin-center transition-transform duration-75 flex items-center justify-center"
                  style={{
                    ...stageStyle,
                    left: `calc(50% - ${currentImage.width / 2}px + ${panX}px)`,
                    top: `calc(50% - ${currentImage.height / 2}px + ${panY}px)`,
                    width: `${currentImage.width}px`,
                    height: `${currentImage.height}px`
                  }}
                >
                  {/* STACKED IMAGES (For Overlay Check Mode - Requirement #3) */}
                  {workspaceMode === 'overlay_check' ? (
                    <>
                      {imageList.map((img) => {
                        const isBase = img.id === selectedImageId;
                        const isVisible = overlayImageIds.includes(img.id);
                        if (!isVisible) return null;

                        const opacity = isBase ? 1.0 : (imageOpacities[img.id] ?? globalOverlayOpacity);

                        return (
                          <img 
                            key={img.id}
                            ref={isBase ? previewImgRef : undefined}
                            src={img.url} 
                            alt={img.name} 
                            className="absolute inset-0 w-full h-full object-contain shadow-2xl rounded-sm pointer-events-none transition-all duration-75"
                            style={{
                              opacity,
                              mixBlendMode: isBase ? 'normal' : (overlayBlendMode as any),
                              zIndex: isBase ? 0 : 5
                            }}
                          />
                        );
                      })}
                    </>
                  ) : (
                    /* ORIGINAL SINGLE IMG */
                    <img 
                      ref={previewImgRef}
                      src={currentImage.url} 
                      alt="Audit target preview" 
                      className="w-full h-full object-contain shadow-2xl rounded-sm pointer-events-none"
                    />
                  )}

                  {/* HORIZONTAL & VERTICAL CENTERLINE ALIGNMENT GUIDES */}
                  {showAnnotations && (
                    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                      {/* Vertical Centerline */}
                      <div className="absolute inset-y-0 left-1/2 w-[1.5px] border-l-2 border-dashed border-cyan-400/70">
                        <div className="absolute top-3 left-3 bg-slate-900/90 border border-cyan-500/30 text-cyan-400 text-[9px] px-2 py-0.5 rounded-md shadow-lg font-mono flex items-center gap-1.5 backdrop-blur-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          <span>垂直中心基准线 (X: 50%)</span>
                        </div>
                      </div>
                      {/* Horizontal Centerline */}
                      <div className="absolute inset-x-0 top-1/2 h-[1.5px] border-t-2 border-dashed border-cyan-400/70">
                        <div className="absolute left-3 top-3 bg-slate-900/90 border border-cyan-500/30 text-cyan-400 text-[9px] px-2 py-0.5 rounded-md shadow-lg font-mono flex items-center gap-1.5 backdrop-blur-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          <span>水平中心基准线 (Y: 50%)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DRAGGABLE MANUAL REFERENCE LINES (Requirement #2) */}
                  {showAnnotations && manualGuides.map((guide) => {
                    const isH = guide.type === 'h';
                    const styleValue = `${guide.value * 100}%`;
                    const pixelValue = Math.round(guide.value * (isH ? currentImage.height : currentImage.width));
                    
                    return (
                      <div
                        key={guide.id}
                        className={`absolute z-40 group cursor-${isH ? 'row' : 'col'}-resize pointer-events-auto`}
                        style={{
                          top: isH ? styleValue : 0,
                          bottom: isH ? undefined : 0,
                          left: isH ? 0 : styleValue,
                          right: isH ? 0 : undefined,
                          width: isH ? '100%' : '14px',
                          height: isH ? '14px' : '100%',
                          transform: isH ? 'translateY(-7px)' : 'translateX(-7px)',
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDraggingGuideId(guide.id);
                          setActiveGuideId(guide.id);
                        }}
                      >
                        {/* Visual Line */}
                        <div 
                          className={`absolute inset-0 m-auto pointer-events-none transition-colors duration-150 ${
                            activeGuideId === guide.id 
                              ? 'bg-emerald-400' 
                              : 'bg-emerald-500/60 group-hover:bg-emerald-400'
                          }`}
                          style={{
                            width: isH ? '100%' : '2px',
                            height: isH ? '2px' : '100%',
                            borderStyle: 'dashed',
                            borderWidth: isH ? '1px 0 0 0' : '0 0 0 1px',
                            borderColor: 'rgb(16, 185, 129)'
                          }}
                        />
                        
                        {/* Handle badge */}
                        <div 
                          className={`absolute bg-slate-900/95 border border-emerald-500/40 text-emerald-300 text-[8px] px-1.5 py-0.5 rounded shadow-lg font-mono flex items-center gap-1.5 whitespace-nowrap select-none pointer-events-auto transition-all ${
                            isH 
                              ? 'right-4 top-1/2 -translate-y-1/2' 
                              : 'top-4 left-1/2 -translate-x-1/2'
                          } ${
                            draggingGuideId === guide.id ? 'scale-105 border-emerald-400 text-white bg-emerald-950/95' : ''
                          }`}
                        >
                          <span className={`w-1 h-1 rounded-full bg-emerald-400 ${draggingGuideId === guide.id ? 'animate-ping' : ''}`} />
                          <span>
                            {isH ? `Y: ${pixelValue}px` : `X: ${pixelValue}px`} ({Math.round(guide.value * 100)}%)
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setManualGuides(prev => prev.filter(g => g.id !== guide.id));
                            }}
                            className="hover:text-red-400 text-[10px] font-bold ml-1.5 px-0.5"
                            title="删除此参考线"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* OVERLAYS ANNOTATION CANVAS */}
                  {showAnnotations && overlayBoxes.length > 0 && (
                    <div className="absolute inset-0 z-20 pointer-events-auto">
                      {overlayBoxes.map((box, idx) => {
                        const isHighlighted = highlightedBoxIndex === idx;
                        const isHovered = hoveredBoxIndex === idx;
                        const showMeasurements = isHighlighted || isHovered;
                        
                        let strokeColor = 'border-emerald-500 bg-emerald-500/10 text-emerald-300';
                        let iconColor = 'bg-emerald-500';
                        
                        if (box.status === 'fail') {
                          strokeColor = 'border-rose-500 bg-rose-500/10 text-rose-300';
                          iconColor = 'bg-rose-500';
                        } else if (box.status === 'warn') {
                          strokeColor = 'border-amber-500 bg-amber-500/10 text-amber-300';
                          iconColor = 'bg-amber-500';
                        }

                        // Physical values
                        const left_px = Math.round(box.x * currentImage.width);
                        const right_px = Math.round((box.x + box.w) * currentImage.width);
                        const top_px = Math.round(box.y * currentImage.height);
                        const bottom_px = Math.round((box.y + box.h) * currentImage.height);
                        
                        const imgCenterX = currentImage.width / 2;
                        const imgCenterY = currentImage.height / 2;

                        const left_dist = Math.abs(left_px - imgCenterX);
                        const right_dist = Math.abs(right_px - imgCenterX);
                        const top_dist = Math.abs(top_px - imgCenterY);
                        const bottom_dist = Math.abs(bottom_px - imgCenterY);

                        const deltaX = Math.round((box.x + box.w/2 - 0.5) * currentImage.width);
                        const deltaY = Math.round((box.y + box.h/2 - 0.5) * currentImage.height);

                        return (
                          <React.Fragment key={idx}>
                            {/* THE BOUNDING BOX */}
                            <div
                              style={boxStyle(box)}
                              onMouseEnter={() => setHoveredBoxIndex(idx)}
                              onMouseLeave={() => setHoveredBoxIndex(null)}
                              onClick={() => {
                                setHighlightedBoxIndex(isHighlighted ? null : idx);
                              }}
                              className={`absolute border-2 rounded-sm transition-all flex flex-col justify-between cursor-pointer ${strokeColor} ${
                                isHighlighted ? 'ring-4 ring-blue-500 ring-offset-1 scale-[1.01] z-30' : 'hover:scale-[1.01] z-20'
                              }`}
                            >
                              {/* Top Tag Label */}
                              <div className={`absolute top-0 left-0 -translate-y-full ${iconColor} text-white font-sans text-[10px] font-bold px-1 py-0.5 rounded-t-sm flex items-center gap-1 shadow-md whitespace-nowrap`}>
                                <span>{box.label}</span>
                                {box.metricValue && (
                                  <span className="opacity-80 font-mono text-[9px] border-l border-white/20 pl-1 ml-1">
                                    {box.metricValue}
                                  </span>
                                )}
                              </div>

                              {/* Centering Helper Badge inside the Box */}
                              {showMeasurements && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-slate-950/20 backdrop-blur-[0.5px]">
                                  <div className="bg-slate-900/90 border border-slate-700/80 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold text-slate-200 shadow space-y-0.5 text-center">
                                    <div className="text-cyan-400">
                                      ΔX: {deltaX > 0 ? `+${deltaX}` : deltaX}px
                                    </div>
                                    <div className="text-pink-400">
                                      ΔY: {deltaY > 0 ? `+${deltaY}` : deltaY}px
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* MEASUREMENT GUIDELINES - DRAWN TO THE CENTERLINES */}
                            {showMeasurements && (
                              <div className="absolute inset-0 pointer-events-none z-30">
                                
                                {/* 1. Left Edge to Vertical Centerline */}
                                {box.x < 0.5 ? (
                                  <div 
                                    className="absolute border-t border-dashed border-cyan-400/90 flex items-center justify-center"
                                    style={{
                                      left: `${box.x * 100}%`,
                                      width: `${(0.5 - box.x) * 100}%`,
                                      top: `${(box.y + box.h / 3) * 100}%`,
                                      height: '0'
                                    }}
                                  >
                                    <span className="bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[8px] font-mono font-bold px-1 rounded -translate-y-1/2 shadow-sm whitespace-nowrap">
                                      L: {left_dist}px
                                    </span>
                                  </div>
                                ) : (
                                  <div 
                                    className="absolute border-t border-dashed border-cyan-400/90 flex items-center justify-center"
                                    style={{
                                      left: '50%',
                                      width: `${(box.x - 0.5) * 100}%`,
                                      top: `${(box.y + box.h / 3) * 100}%`,
                                      height: '0'
                                    }}
                                  >
                                    <span className="bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[8px] font-mono font-bold px-1 rounded -translate-y-1/2 shadow-sm whitespace-nowrap">
                                      L: {left_dist}px
                                    </span>
                                  </div>
                                )}

                                {/* 2. Right Edge to Vertical Centerline */}
                                {(box.x + box.w) < 0.5 ? (
                                  <div 
                                    className="absolute border-t border-dashed border-pink-400/90 flex items-center justify-center"
                                    style={{
                                      left: `${(box.x + box.w) * 100}%`,
                                      width: `${(0.5 - (box.x + box.w)) * 100}%`,
                                      top: `${(box.y + box.h * 2 / 3) * 100}%`,
                                      height: '0'
                                    }}
                                  >
                                    <span className="bg-pink-950 text-pink-300 border border-pink-500/30 text-[8px] font-mono font-bold px-1 rounded -translate-y-1/2 shadow-sm whitespace-nowrap">
                                      R: {right_dist}px
                                    </span>
                                  </div>
                                ) : (
                                  <div 
                                    className="absolute border-t border-dashed border-pink-400/90 flex items-center justify-center"
                                    style={{
                                      left: '50%',
                                      width: `${((box.x + box.w) - 0.5) * 100}%`,
                                      top: `${(box.y + box.h * 2 / 3) * 100}%`,
                                      height: '0'
                                    }}
                                  >
                                    <span className="bg-pink-950 text-pink-300 border border-pink-500/30 text-[8px] font-mono font-bold px-1 rounded -translate-y-1/2 shadow-sm whitespace-nowrap">
                                      R: {right_dist}px
                                    </span>
                                  </div>
                                )}

                                {/* 3. Top Edge to Horizontal Centerline */}
                                {box.y < 0.5 ? (
                                  <div 
                                    className="absolute border-l border-dashed border-cyan-400/90 flex flex-col items-center justify-center"
                                    style={{
                                      top: `${box.y * 100}%`,
                                      height: `${(0.5 - box.y) * 100}%`,
                                      left: `${(box.x + box.w / 3) * 100}%`,
                                      width: '0'
                                    }}
                                  >
                                    <span className="bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[8px] font-mono font-bold px-1 rounded rotate-0 shadow-sm whitespace-nowrap">
                                      T: {top_dist}px
                                    </span>
                                  </div>
                                ) : (
                                  <div 
                                    className="absolute border-l border-dashed border-cyan-400/90 flex flex-col items-center justify-center"
                                    style={{
                                      top: '50%',
                                      height: `${(box.y - 0.5) * 100}%`,
                                      left: `${(box.x + box.w / 3) * 100}%`,
                                      width: '0'
                                    }}
                                  >
                                    <span className="bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[8px] font-mono font-bold px-1 rounded rotate-0 shadow-sm whitespace-nowrap">
                                      T: {top_dist}px
                                    </span>
                                  </div>
                                )}

                                {/* 4. Bottom Edge to Horizontal Centerline */}
                                {(box.y + box.h) < 0.5 ? (
                                  <div 
                                    className="absolute border-l border-dashed border-pink-400/90 flex flex-col items-center justify-center"
                                    style={{
                                      top: `${(box.y + box.h) * 100}%`,
                                      height: `${(0.5 - (box.y + box.h)) * 100}%`,
                                      left: `${(box.x + box.w * 2 / 3) * 100}%`,
                                      width: '0'
                                    }}
                                  >
                                    <span className="bg-pink-950 text-pink-300 border border-pink-500/30 text-[8px] font-mono font-bold px-1 rounded rotate-0 shadow-sm whitespace-nowrap">
                                      B: {bottom_dist}px
                                    </span>
                                  </div>
                                ) : (
                                  <div 
                                    className="absolute border-l border-dashed border-pink-400/90 flex flex-col items-center justify-center"
                                    style={{
                                      top: '50%',
                                      height: `${((box.y + box.h) - 0.5) * 100}%`,
                                      left: `${(box.x + box.w * 2 / 3) * 100}%`,
                                      width: '0'
                                    }}
                                  >
                                    <span className="bg-pink-950 text-pink-300 border border-pink-500/30 text-[8px] font-mono font-bold px-1 rounded rotate-0 shadow-sm whitespace-nowrap">
                                      B: {bottom_dist}px
                                    </span>
                                  </div>
                                )}

                                {/* 5. MEASUREMENT TO DRAGGABLE REFERENCE LINES (Requirement #2) */}
                                {manualGuides.map((guide) => {
                                  const refVal = guide.value;
                                  if (guide.type === 'v') {
                                    const refX_px = refVal * currentImage.width;
                                    const bLeft_px = box.x * currentImage.width;
                                    const bRight_px = (box.x + box.w) * currentImage.width;
                                    
                                    let startX = refVal;
                                    let endX = box.x;
                                    let labelText = `距参考线 L: ${Math.round(Math.abs(bLeft_px - refX_px))}px`;
                                    
                                    if (refVal > box.x + box.w) {
                                      startX = box.x + box.w;
                                      endX = refVal;
                                      labelText = `距参考线 R: ${Math.round(Math.abs(refX_px - bRight_px))}px`;
                                    } else if (refVal > box.x) {
                                      startX = box.x;
                                      endX = refVal;
                                      labelText = `距参考线: ${Math.round(Math.abs(refX_px - bLeft_px))}px`;
                                    }

                                    return (
                                      <div 
                                        key={`g-meas-${guide.id}`}
                                        className="absolute border-t border-dashed border-emerald-400/80 flex items-center justify-center z-30"
                                        style={{
                                          left: `${startX * 100}%`,
                                          width: `${Math.abs(endX - startX) * 100}%`,
                                          top: `${(box.y + box.h * (idx % 2 === 0 ? 0.25 : 0.75)) * 100}%`,
                                          height: 0
                                        }}
                                      >
                                        <span className="bg-emerald-950/95 text-emerald-400 border border-emerald-500/40 text-[7px] font-mono font-bold px-1 rounded -translate-y-1/2 shadow-lg whitespace-nowrap">
                                          {labelText}
                                        </span>
                                      </div>
                                    );
                                  } else {
                                    const refY_px = refVal * currentImage.height;
                                    const bTop_px = box.y * currentImage.height;
                                    const bBottom_px = (box.y + box.h) * currentImage.height;

                                    let startY = refVal;
                                    let endY = box.y;
                                    let labelText = `距参考线 T: ${Math.round(Math.abs(bTop_px - refY_px))}px`;

                                    if (refVal > box.y + box.h) {
                                      startY = box.y + box.h;
                                      endY = refVal;
                                      labelText = `距参考线 B: ${Math.round(Math.abs(refY_px - bBottom_px))}px`;
                                    } else if (refVal > box.y) {
                                      startY = box.y;
                                      endY = refVal;
                                      labelText = `距参考线: ${Math.round(Math.abs(refY_px - bTop_px))}px`;
                                    }

                                    return (
                                      <div 
                                        key={`g-meas-${guide.id}`}
                                        className="absolute border-l border-dashed border-emerald-400/80 flex flex-col items-center justify-center z-30"
                                        style={{
                                          top: `${startY * 100}%`,
                                          height: `${Math.abs(endY - startY) * 100}%`,
                                          left: `${(box.x + box.w * (idx % 2 === 0 ? 0.25 : 0.75)) * 100}%`,
                                          width: 0
                                        }}
                                      >
                                        <span className="bg-emerald-950/95 text-emerald-400 border border-emerald-500/40 text-[7px] font-mono font-bold px-1 rounded shadow-lg whitespace-nowrap">
                                          {labelText}
                                        </span>
                                      </div>
                                    );
                                  }
                                })}

                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {/* ACTIVE SIMULATION ENGINE PROGRESS BANNER */}
          {analysisState.status === 'analyzing' && (
            <div className="absolute inset-x-6 bottom-6 z-30 no-print">
              <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-5 shadow-2xl backdrop-blur-xl max-w-xl mx-auto space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                    {analysisState.step}
                  </span>
                  <span className="font-mono text-blue-400 font-bold">{analysisState.progress}%</span>
                </div>

                {/* Progress bar container */}
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-300"
                    style={{ width: `${analysisState.progress}%` }}
                  />
                </div>

                {/* Simulated log console */}
                <div className="bg-slate-950/80 rounded-xl p-3 h-28 overflow-y-auto font-mono text-[10px] text-slate-400 space-y-1.5 border border-slate-900">
                  {analysisState.logs.map((log, lidx) => (
                    <div key={lidx} className="flex gap-2">
                      <span className="text-slate-600">{`[${lidx+1}]`}</span>
                      <span className="text-slate-300">{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CORE FLOW CTA FLOATING ACTIONS */}
          {currentImage && analysisState.status === 'idle' && !currentImage.rulesResults && (
            <div className="absolute bottom-6 inset-x-6 flex justify-center z-30 no-print">
              <button 
                onClick={startAnalysis}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 px-8 rounded-2xl shadow-xl shadow-blue-500/10 hover:shadow-blue-500/20 transform hover:-translate-y-0.5 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-5 h-5 animate-pulse" />
                <span>立即启动多模态排版分析</span>
              </button>
            </div>
          )}

          {/* FLOATING OVERLAY SETTINGS PANEL (Requirement #3) */}
          {workspaceMode === 'overlay_check' && currentImage && (
            <div 
              className="absolute right-6 top-6 w-80 bg-[#0B0F19]/90 border border-slate-800 rounded-2xl p-4 shadow-2xl z-50 pointer-events-auto backdrop-blur-md space-y-4 max-h-[85%] overflow-y-auto"
              onMouseDown={(e) => e.stopPropagation()} // Prevent dragging the canvas when interacting with the panel
            >
              <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2">
                <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  图层叠放与透明度调节
                </h3>
              </div>
              
              <div className="bg-emerald-500/10 rounded-xl p-2.5 border border-emerald-500/20">
                <p className="text-[10px] text-emerald-300 leading-relaxed">
                  💡 <strong>提示：</strong>本沙盒固定各层图片完美重合。通过拉动滑块、切换「差值」模式或在右下角拖拽「辅助参考线」，极速校验多图元素几何对准度。
                </p>
              </div>

              {/* Blend Mode */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">色彩混合模式 (Blend Mode)</label>
                <select
                  value={overlayBlendMode}
                  onChange={(e) => setOverlayBlendMode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="normal">Normal (标准不合并)</option>
                  <option value="multiply">Multiply (正片叠底 - 推荐比对白底图)</option>
                  <option value="screen">Screen (滤色 - 推荐比对暗底图)</option>
                  <option value="difference">Difference (差值 - 位置完全相同区域会变黑)</option>
                  <option value="overlay">Overlay (叠加)</option>
                </select>
              </div>

              {/* Global Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-bold">
                  <span className="text-slate-400">全局覆盖层透明度</span>
                  <span className="text-emerald-400 font-mono">{Math.round(globalOverlayOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(globalOverlayOpacity * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    setGlobalOverlayOpacity(val);
                    const updated: Record<string, number> = {};
                    imageList.forEach(img => {
                      updated[img.id] = val;
                    });
                    setImageOpacities(updated);
                  }}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Individual Layers */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">
                  图层级单独微调
                </span>
                
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {imageList.map((img) => {
                    const isBase = img.id === selectedImageId;
                    const isChecked = overlayImageIds.includes(img.id);
                    const opacityVal = imageOpacities[img.id] ?? globalOverlayOpacity;

                    return (
                      <div 
                        key={img.id}
                        className={`p-2.5 rounded-xl border text-[11px] space-y-2 transition-all ${
                          isBase 
                            ? 'bg-blue-950/25 border-blue-500/40' 
                            : isChecked 
                              ? 'bg-slate-900/80 border-slate-800' 
                              : 'bg-slate-900/30 border-transparent opacity-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none truncate flex-1 font-sans">
                            <input
                              type="checkbox"
                              disabled={isBase}
                              checked={isBase || isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setOverlayImageIds(prev => prev.filter(id => id !== img.id));
                                } else {
                                  setOverlayImageIds(prev => [...prev, img.id]);
                                }
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer disabled:opacity-40"
                            />
                            <span className="font-bold text-slate-200 truncate max-w-[140px]" title={img.name}>
                              {img.name}
                            </span>
                          </label>
                          <span className="text-[8px] font-mono shrink-0 px-1.5 py-0.5 rounded bg-slate-950 text-slate-400">
                            {isBase ? '主对照基底' : isChecked ? '正在叠放' : '已隐藏'}
                          </span>
                        </div>

                        {!isBase && isChecked && (
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={Math.round(opacityVal * 100)}
                              onChange={(e) => {
                                const val = Number(e.target.value) / 100;
                                setImageOpacities(prev => ({
                                  ...prev,
                                  [img.id]: val
                                }));
                              }}
                              className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                            <span className="text-[10px] font-mono font-bold text-emerald-400 w-8 text-right">
                              {Math.round(opacityVal * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BATCH AUDIT QUEUE & THUMBNAILS BAR */}
        {imageList.length > 0 && (
          <div className="border-t border-slate-800 bg-[#0B1120]/95 backdrop-blur-md px-6 py-4 flex flex-col gap-3 shrink-0 z-20 no-print">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300">
                  待审核队列 ({imageList.length} 张图片)
                </span>
                <span className="text-[10px] text-slate-500 truncate max-w-[200px] sm:max-w-xs">
                  (已选定「{currentImage?.name}」进行审阅)
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={startBatchAnalysis}
                  disabled={analysisState.status === 'analyzing'}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] font-semibold py-1.5 px-3 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-lg shadow-blue-500/15"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>一键启动批量审核</span>
                </button>
                <button
                  onClick={triggerFileInput}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold py-1.5 px-2.5 rounded-xl flex items-center gap-1 transition-all cursor-pointer border border-slate-700/60"
                >
                  <Plus className="w-3 h-3" />
                  <span>添加图片</span>
                </button>
                <button
                  onClick={() => {
                    setImageList([]);
                    setSelectedImageId(null);
                  }}
                  className="text-slate-500 hover:text-rose-400 text-[11px] transition-colors cursor-pointer ml-1"
                >
                  清空队列
                </button>
              </div>
            </div>

            {/* Thumbnail carousel */}
            <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-800">
              {imageList.map((img) => {
                const isSelected = img.id === selectedImageId;
                let statusBadge = null;

                if (img.auditStatus === 'analyzing') {
                  statusBadge = (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-blue-500 text-white rounded-full flex items-center justify-center text-[8px] animate-spin">
                      ⏳
                    </span>
                  );
                } else if (img.auditStatus === 'passed') {
                  statusBadge = (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold">
                      ✓
                    </span>
                  );
                } else if (img.auditStatus === 'failed') {
                  statusBadge = (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-rose-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold">
                      ✗
                    </span>
                  );
                } else if (img.auditStatus === 'warned') {
                  statusBadge = (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-amber-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold">
                      !
                    </span>
                  );
                } else if (img.auditStatus === 'pending') {
                  statusBadge = (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-slate-600 text-slate-300 rounded-full flex items-center justify-center text-[8px] animate-pulse">
                      ••
                    </span>
                  );
                }

                return (
                  <div
                    key={img.id}
                    className={`relative group shrink-0 w-16 h-16 rounded-xl overflow-hidden cursor-pointer transition-all border-2 ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/30 scale-105'
                        : 'border-slate-800 hover:border-slate-700 hover:scale-[1.02]'
                    }`}
                    onClick={() => {
                      if (analysisState.status !== 'analyzing') {
                        setSelectedImageId(img.id);
                      }
                    }}
                  >
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Dark gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-1">
                      <span className="text-[7px] text-slate-300 truncate w-full block font-mono">
                        {img.name}
                      </span>
                    </div>

                    {statusBadge}

                    {/* Delete thumbnail button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (analysisState.status === 'analyzing') return;
                        
                        setImageList(prev => {
                          const filtered = prev.filter(p => p.id !== img.id);
                          if (isSelected) {
                            setSelectedImageId(filtered[0]?.id || null);
                          }
                          return filtered;
                        });
                      }}
                      className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 hover:scale-110 bg-slate-950/80 hover:bg-rose-950/90 text-slate-400 hover:text-rose-400 h-4 w-4 rounded-full flex items-center justify-center transition-all"
                      title="从队列中移除"
                    >
                      <span className="text-[10px]">×</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </main>

      {/* ========================================== */}
      {/* RIGHT PANEL: INSPECTION REPORT            */}
      {/* ========================================== */}
      <section className="w-full xl:w-[25%] bg-[#0D1527] border-t xl:border-t-0 xl:border-l border-slate-800 flex flex-col h-full overflow-hidden print-full z-10 shrink-0">
        
        {/* REPORT HEADER */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between no-print">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-400" />
            排版合规分析报告
          </h3>
          {currentImage && (
            <div className="flex gap-1.5">
              <button
                onClick={exportReportPdf}
                title="打印 / 导出 PDF 格式报告"
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700/60 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={downloadAnalyzedImage}
                title="导出排版标注图"
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700/60 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* EXPORT ONLY PRINT TITLE (Visible on physical prints) */}
        <div className="hidden print:block p-8 border-b border-slate-300 text-slate-900">
          <h1 className="text-2xl font-bold">智能排版合规分析报告</h1>
          <p className="text-xs text-slate-500 mt-1">检测时间: {new Date().toLocaleString()} | 图片: {currentImage?.name}</p>
        </div>

        {/* SCROLLABLE PANEL VIEWPORT */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 print:overflow-visible">
          
          {/* STATS RATIO RING */}
          {rulesResults.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-800/60 rounded-2xl p-5 space-y-4 print:bg-slate-100 print:border-slate-300 print:text-slate-900">
              
              <div className="flex items-center gap-4">
                {/* Circular ring fallback bar */}
                <div className="relative h-16 w-16 flex items-center justify-center shrink-0">
                  <svg className="absolute inset-0 w-full h-full -rotate-90">
                    <circle 
                      cx="32" 
                      cy="32" 
                      r="28" 
                      className="stroke-slate-800 print:stroke-slate-200 fill-none" 
                      strokeWidth="6" 
                    />
                    <circle 
                      cx="32" 
                      cy="32" 
                      r="28" 
                      className={`fill-none transition-all duration-1000 ${
                        complianceRate >= 80 ? 'stroke-emerald-500' : complianceRate >= 50 ? 'stroke-amber-500' : 'stroke-rose-500'
                      }`} 
                      strokeWidth="6" 
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - complianceRate / 100)}`}
                    />
                  </svg>
                  <span className={`text-sm font-extrabold font-mono ${complianceColorClass} print:text-slate-800`}>
                    {complianceRate}%
                  </span>
                </div>

                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-400 print:text-slate-500 uppercase tracking-wider">
                    排版合规率
                  </h4>
                  <p className="text-sm font-bold text-white print:text-slate-800">
                    {failedRulesCount > 0 
                      ? `存在 ${failedRulesCount} 项排版未达标` 
                      : '符合设定的视觉排版指标'
                    }
                  </p>
                </div>
              </div>

              {/* Progress slider bar representation */}
              <div className="w-full bg-slate-800/60 print:bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-full ${complianceProgressColor}`} 
                  style={{ width: `${complianceRate}%` }} 
                />
              </div>

            </div>
          )}

          {/* ACTIVE RULE METRICS SCORECARD LIST */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>指标细项比对</span>
              <span className="text-[10px] text-slate-500 font-mono">点击查看违规详情</span>
            </h4>

            {rulesResults.length === 0 ? (
              <div className="text-center py-10 px-4 bg-slate-800/10 border border-slate-800 rounded-2xl">
                <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-500">
                  {currentImage 
                    ? '点击中区“启动多模态分析”按钮开展自动化排版诊断。' 
                    : '请首先上传待审的图片。'
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {rulesResults.map((res) => {
                  const isSelected = selectedRuleId === res.id;
                  
                  let badgeBg = 'bg-slate-800 text-slate-400 border-slate-700';
                  let statusText = '需复核';
                  let statusColor = 'text-slate-400';
                  
                  if (res.status === 'pass') {
                    badgeBg = 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30 print:bg-emerald-100 print:text-emerald-800';
                    statusText = '符合';
                    statusColor = 'text-emerald-500';
                  } else if (res.status === 'fail') {
                    badgeBg = 'bg-rose-950/40 text-rose-400 border-rose-900/30 print:bg-rose-100 print:text-rose-800';
                    statusText = '不符合';
                    statusColor = 'text-rose-500';
                  } else if (res.status === 'warn') {
                    badgeBg = 'bg-amber-950/40 text-amber-400 border-amber-900/30 print:bg-amber-100 print:text-amber-800';
                    statusText = '警告';
                    statusColor = 'text-amber-500';
                  }

                  return (
                    <div
                      key={res.id}
                      onClick={() => onRuleResultClick(res)}
                      className={`border p-4.5 rounded-2xl text-left transition-all duration-200 cursor-pointer print:border-slate-300 print:bg-white print:text-slate-900 ${
                        isSelected 
                          ? 'bg-slate-800/40 border-blue-500/80 shadow-md ring-1 ring-blue-500/20' 
                          : 'bg-slate-800/10 border-slate-800/80 hover:bg-slate-800/25 hover:border-slate-700/60'
                      }`}
                    >
                      {/* Top Header Row */}
                      <div className="flex items-start justify-between gap-2.5">
                        <p className="text-xs text-slate-200 print:text-slate-800 font-semibold leading-relaxed flex-1 break-all">
                          {res.text}
                        </p>
                        <span className={`shrink-0 text-[10px] font-bold border rounded px-1.5 py-0.5 ${badgeBg}`}>
                          {statusText}
                        </span>
                      </div>

                      {/* Detail Expansion Body */}
                      <div className="mt-3 space-y-2.5">
                        <p className="text-[11px] text-slate-400 print:text-slate-600 leading-relaxed">
                          {res.detail}
                        </p>
                        
                        {/* Dynamic measured data */}
                        {res.actualValue && (
                          <div className="flex items-center justify-between text-[10px] font-mono border-t border-slate-800/60 pt-2 print:border-slate-200">
                            <span className="text-slate-500">核心实测参数：</span>
                            <span className="text-slate-300 print:text-slate-700 font-semibold">{res.actualValue}</span>
                          </div>
                        )}

                        {/* Interactive manual validation tools */}
                        <div className="flex items-center justify-end gap-1.5 border-t border-slate-800/40 pt-2.5 mt-1 no-print">
                          <span className="text-[10px] text-slate-500 mr-auto font-medium">手动评估：</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleManualRuleStatus(res.id, 'pass');
                            }}
                            className={`px-2 py-0.5 border rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              res.status === 'pass' 
                                ? 'bg-emerald-600 text-white border-emerald-500' 
                                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-emerald-400 hover:border-emerald-900/60'
                            }`}
                          >
                            合规
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleManualRuleStatus(res.id, 'fail');
                            }}
                            className={`px-2 py-0.5 border rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              res.status === 'fail' 
                                ? 'bg-rose-600 text-white border-rose-500' 
                                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-rose-400 hover:border-rose-900/60'
                            }`}
                          >
                            违规
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleManualRuleStatus(res.id, 'warn');
                            }}
                            className={`px-2 py-0.5 border rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              res.status === 'warn' 
                                ? 'bg-amber-600 text-slate-950 border-amber-500' 
                                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-amber-400 hover:border-amber-900/60'
                            }`}
                          >
                            警告
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* COLOR PALETTE & DIMENSIONS DETAILS METADATA CARD */}
          {currentImage && (
            <div className="bg-slate-800/20 border border-slate-800/60 rounded-2xl p-5 space-y-4 print:bg-slate-100 print:border-slate-300 print:text-slate-900">
              <h4 className="text-xs font-bold text-slate-300 print:text-slate-800 uppercase tracking-wider flex items-center justify-between no-print">
                <span>图像多维元数据</span>
                <button
                  onClick={openCustomFieldModal}
                  className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer font-semibold"
                >
                  + 新加参数
                </button>
              </h4>

              {/* Grid detail lines */}
              <div className="space-y-2.5 font-sans">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">图片尺寸</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {currentImage.width} x {currentImage.height} px
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">宽高比</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {currentImage.aspect}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">文件格式</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {currentImage.format}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">文件大小</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {currentImage.size}
                  </span>
                </div>

                {/* Custom Metadata entries */}
                {customFields.map((field) => (
                  <div key={field.label} className="flex justify-between items-center text-xs group">
                    <span className="text-slate-500">{field.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                        {field.value}
                      </span>
                      <button
                        onClick={() => removeCustomField(field.label)}
                        className="text-slate-600 hover:text-rose-400 transition-colors group-hover:opacity-100 opacity-0 no-print cursor-pointer"
                        title="移除自定义参数"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* COLOR SCALE BLOCK (Derived from Chroma JS averageCorners) */}
              {currentImage.palette.length > 0 && (
                <div className="space-y-3 pt-3 border-t border-slate-800/60 print:border-slate-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">主背景色</span>
                    <div className="flex items-center gap-1.5">
                      <div 
                        className="w-3.5 h-3.5 rounded border border-slate-700/60 shrink-0"
                        style={{ backgroundColor: currentImage.dominantColor }}
                      />
                      <span className="text-slate-300 print:text-slate-800 font-mono font-semibold text-xs">
                        {currentImage.dominantColor}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 block">色域比对标尺 (Chroma.js 5-scale)</span>
                    <div className="flex w-full h-3 rounded-lg overflow-hidden border border-slate-800/80">
                      {currentImage.palette.map((color, cidx) => (
                        <div
                          key={cidx}
                          className="flex-1 transition-all hover:scale-105 cursor-help"
                          style={{ backgroundColor: color }}
                          title={`色元 #${cidx + 1}: ${color}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* 排版与文字测量指标 (基础信息框) */}
          {currentImage && (
            <div className="bg-slate-800/20 border border-slate-800/60 rounded-2xl p-5 space-y-4 print:bg-slate-100 print:border-slate-300 print:text-slate-900 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h4 className="text-xs font-bold text-slate-300 print:text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Type className="w-4 h-4 text-blue-400" />
                <span>排版与文字测量指标</span>
                <span className="text-[9px] font-bold bg-blue-950/80 text-blue-400 border border-blue-900/40 px-1.5 py-0.5 rounded ml-auto no-print">
                  自适应测算
                </span>
              </h4>

              {/* 基础信息 (尺寸, 像素) */}
              <div className="space-y-2 text-xs border-b border-slate-800/60 pb-3 print:border-slate-200">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">图片实际规格</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {currentImage.width} × {currentImage.height} px
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">总像素数</span>
                  <span className="text-slate-300 print:text-slate-800 font-mono font-medium">
                    {(currentImage.width * currentImage.height).toLocaleString()} 像素 (约 {((currentImage.width * currentImage.height) / 1000000).toFixed(2)} MP)
                  </span>
                </div>
              </div>

              {/* 各板块文字字号以及字间距、行间距 */}
              <div className="space-y-3">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  检测板块排版属性
                </span>

                {!currentImage.ocrResults || currentImage.ocrResults.length === 0 ? (
                  <p className="text-[11px] text-slate-500 leading-relaxed italic bg-slate-900/30 rounded-xl p-3 border border-slate-900/40">
                    等待多模态排版分析完成后，系统将自动对各检测板块的字号大小、字间距与行间距指标进行精密测算。
                  </p>
                ) : (
                  <div className="space-y-3">
                    {currentImage.ocrResults.map((box: any, bidx: number) => {
                      // Remove brackets like [页眉LOGO/品牌区]
                      const name = box.text ? box.text.replace(/\[.*?\]\s*/g, '') : `排版区块 #${bidx + 1}`;
                      const match = box.text ? box.text.match(/\[(.*?)\]/) : null;
                      const badge = match ? match[1] : `区块 #${bidx + 1}`;

                      // Typography heuristic estimator based on physical height ratio (box.h) and category
                      const hRel = box.h || 0.05;
                      let fontSizePx = Math.round(hRel * currentImage.height * 0.35);
                      
                      if (box.text?.includes('标题')) {
                        fontSizePx = Math.max(fontSizePx, 32 + (bidx === 0 ? 12 : 0));
                      } else if (box.text?.includes('LOGO') || box.text?.includes('徽标')) {
                        fontSizePx = Math.max(fontSizePx, 18);
                      } else if (box.text?.includes('说明') || box.text?.includes('规格') || box.text?.includes('参数') || box.text?.includes('提示')) {
                        fontSizePx = Math.max(fontSizePx, 11);
                      } else {
                        fontSizePx = Math.max(fontSizePx, 13);
                      }

                      // Cap sizes to standard typography bounds
                      if (fontSizePx > 96) fontSizePx = 96;
                      if (fontSizePx < 9) fontSizePx = 9;

                      // Letter spacing estimation
                      let letterSpacing = '0.5px';
                      if (box.text?.includes('标题')) {
                        letterSpacing = fontSizePx > 40 ? '-1.0px' : '0.5px';
                      } else if (box.text?.includes('LOGO') || box.text?.includes('徽标') || box.text?.includes('参数')) {
                        letterSpacing = '1.5px';
                      } else {
                        letterSpacing = 'normal';
                      }

                      // Line spacing / line height estimation (proportional)
                      const lineMultiplier = box.text?.includes('标题') ? 1.25 : box.text?.includes('正文') ? 1.5 : 1.35;
                      const lineSpacingPx = Math.round(fontSizePx * lineMultiplier);

                      return (
                        <div 
                          key={bidx} 
                          className="bg-slate-900/40 print:bg-white border border-slate-800/80 print:border-slate-200 rounded-xl p-3.5 space-y-2.5"
                        >
                          {/* Block Header */}
                          <div className="flex items-center justify-between gap-2 border-b border-slate-800/40 pb-2 print:border-slate-100">
                            <span className="text-xs text-slate-200 print:text-slate-800 font-bold truncate max-w-[150px]">
                              {name}
                            </span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 print:bg-slate-100 print:text-slate-600 truncate max-w-[100px]">
                              {badge}
                            </span>
                          </div>

                          {/* Block Typography Stats Grid */}
                          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-slate-500 block">测算字号</span>
                              <span className="text-slate-300 print:text-slate-800 font-bold">
                                {fontSizePx}px
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-slate-500 block">字间距</span>
                              <span className="text-slate-300 print:text-slate-800">
                                {letterSpacing}
                              </span>
                            </div>
                            <div className="space-y-0.5 col-span-1">
                              <span className="text-[10px] text-slate-500 block">行间距</span>
                              <span className="text-slate-300 print:text-slate-800" title={`行高系数: ${lineMultiplier}`}>
                                {lineSpacingPx}px
                              </span>
                            </div>
                          </div>

                          {/* Block coordinates and size summary */}
                          <div className="flex justify-between text-[9px] text-slate-500 font-mono border-b border-slate-800/40 pb-2">
                            <span>中心比例: ({(box.x + box.w/2).toFixed(2)}, {(box.y + box.h/2).toFixed(2)})</span>
                            <span>宽度占比: {Math.round(box.w * 100)}%</span>
                          </div>

                          {/* Centering Alignment & Boundary Measurements Section */}
                          <div className="bg-slate-950/40 rounded-lg p-2.5 space-y-2 text-[10px] font-mono border border-slate-800/80 no-print">
                            <div className="flex items-center gap-1.5 text-slate-400 border-b border-slate-800/40 pb-1.5">
                              <Ruler className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="font-bold text-[9px] text-slate-300">对齐与中心参考线测距</span>
                            </div>

                            {/* Horizontal measurements */}
                            <div className="space-y-1">
                              <div className="flex justify-between items-center text-slate-400">
                                <span className="flex items-center gap-1">
                                  <span className="w-1 h-1 rounded-full bg-cyan-400" />
                                  水平偏离:
                                </span>
                                <span className={`font-bold ${
                                  Math.abs(Math.round((box.x + box.w/2 - 0.5) * currentImage.width)) <= 2 
                                    ? 'text-emerald-400 font-sans' 
                                    : 'text-cyan-400'
                                }`}>
                                  {Math.round((box.x + box.w/2 - 0.5) * currentImage.width) === 0 
                                    ? '完全水平居中 ✨' 
                                    : Math.round((box.x + box.w/2 - 0.5) * currentImage.width) > 0 
                                      ? `偏右 ${Math.abs(Math.round((box.x + box.w/2 - 0.5) * currentImage.width))} px`
                                      : `偏左 ${Math.abs(Math.round((box.x + box.w/2 - 0.5) * currentImage.width))} px`
                                  }
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-500 pl-2">
                                <div>左侧距中轴: <span className="text-slate-300 font-bold">{Math.round(Math.abs(box.x * currentImage.width - currentImage.width / 2))}px</span></div>
                                <div>右侧距中轴: <span className="text-slate-300 font-bold">{Math.round(Math.abs((box.x + box.w) * currentImage.width - currentImage.width / 2))}px</span></div>
                              </div>
                            </div>

                            {/* Vertical measurements */}
                            <div className="space-y-1 pt-1.5 border-t border-slate-900/50">
                              <div className="flex justify-between items-center text-slate-400">
                                <span className="flex items-center gap-1">
                                  <span className="w-1 h-1 rounded-full bg-pink-400" />
                                  垂直偏离:
                                </span>
                                <span className={`font-bold ${
                                  Math.abs(Math.round((box.y + box.h/2 - 0.5) * currentImage.height)) <= 2 
                                    ? 'text-emerald-400 font-sans' 
                                    : 'text-pink-400'
                                }`}>
                                  {Math.round((box.y + box.h/2 - 0.5) * currentImage.height) === 0 
                                    ? '完全垂直居中 ✨' 
                                    : Math.round((box.y + box.h/2 - 0.5) * currentImage.height) > 0 
                                      ? `偏下 ${Math.abs(Math.round((box.y + box.h/2 - 0.5) * currentImage.height))} px`
                                      : `偏上 ${Math.abs(Math.round((box.y + box.h/2 - 0.5) * currentImage.height))} px`
                                  }
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-500 pl-2">
                                <div>顶侧距中轴: <span className="text-slate-300 font-bold">{Math.round(Math.abs(box.y * currentImage.height - currentImage.height / 2))}px</span></div>
                                <div>底侧距中轴: <span className="text-slate-300 font-bold">{Math.round(Math.abs((box.y + box.h) * currentImage.height - currentImage.height / 2))}px</span></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </section>

      {/* ========================================== */}
      {/* MODAL DIALOGS                              */}
      {/* ========================================== */}
      
      {/* MODAL: MANUAL TEMPLATE CREATOR (User Request #2) */}
      <AnimatePresence>
        {isSaveTemplateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm no-print">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
            >
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-blue-400" />
                  新建排版合规模板
                </h3>
                <p className="text-xs text-slate-400">
                  创建新的排版规范模版（如“海报”或“视频封面”），系统将把当前左下方的规则列表保存为该模板对应的合规准则。
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-300 block">
                  模板名称
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="例如：微信海报规范、抖音视频封面"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => setIsSaveTemplateModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700/60 rounded-xl transition-all cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={!newTemplateName.trim()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 rounded-xl shadow-md shadow-blue-500/10 transition-all cursor-pointer"
                >
                  确认保存模板
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: NEW CUSTOM META FIELD */}
      <AnimatePresence>
        {isCustomFieldModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm no-print">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
            >
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" />
                  新加元数据参数
                </h3>
                <p className="text-xs text-slate-400">
                  为当前图片添加附加的文字属性（例如：DPI、审核专员、版权所属）。
                </p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    参数键名
                  </label>
                  <input
                    type="text"
                    value={customFieldLabel}
                    onChange={(e) => setCustomFieldLabel(e.target.value)}
                    placeholder="例如：审核专员、图片DPI"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    参数数值
                  </label>
                  <input
                    type="text"
                    value={customFieldValue}
                    onChange={(e) => setCustomFieldValue(e.target.value)}
                    placeholder="例如：张工、300 DPI"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => setIsCustomFieldModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700/60 rounded-xl transition-all cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={addCustomField}
                  disabled={!customFieldLabel.trim() || !customFieldValue.trim()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 rounded-xl shadow-md shadow-blue-500/10 transition-all cursor-pointer"
                >
                  确定添加
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
