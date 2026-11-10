/* ============================================================================
   LaTeX 补全候选词表（window.LATEX_COMMANDS）
   ----------------------------------------------------------------------------
   每条：
     cmd    用户输入的命令名（不含反斜杠），触发与过滤都用它
     body   插入到编辑器的文本；${1}..${9} 是 Tab 跳转锚点，可写 ${1:默认文本}，
            ${0} 是最终停点（缺省 = 结尾）。普通符号不带锚点，直接插完加一个空格
     katex  候选行左侧用 KaTeX 渲染的预览（缺省 = \cmd 本身）
     desc   右侧灰色小字说明
     cat    分类（排序时同权重内用作次序参考，也便于以后加分组头）
     w      基础权重，越小越常用（0~999）
     tpl    true = 结构模板（短前缀时让位给同前缀的纯符号，长前缀时反超）
   ========================================================================== */
window.LATEX_COMMANDS = (function () {
  "use strict";

  // ---- 常用结构（body 含锚点）----
  function tpl(cmd, body, katex, desc, w) {
    return { cmd: cmd, body: body, katex: katex, desc: desc, cat: "结构", w: w, tpl: true };
  }
  // ---- 纯符号：插入 "\cmd " ----
  function sym(cmd, desc, cat, w) {
    return { cmd: cmd, body: "\\" + cmd + " ", katex: "\\" + cmd, desc: desc, cat: cat, w: w };
  }
  // ---- 必须带参数的命令（\hat、\mathbf 这类）：插入 "\cmd{...}" 并把光标放进花括号 ----
  function arg(cmd, desc, sample, w) {
    return {
      cmd: cmd,
      body: "\\" + cmd + "{${1}}",
      katex: "\\" + cmd + "{" + (sample || "A") + "}",
      desc: desc,
      cat: "样式",
      w: w,
      tpl: true,
    };
  }
  // ---- 函数名：预览里带个 x ----
  function fn(cmd, desc, w) {
    return { cmd: cmd, body: "\\" + cmd + " ", katex: "\\" + cmd + " x", desc: desc, cat: "函数", w: w };
  }

  return [
    // ================= 结构模板（0~149） =================
    tpl("frac", "\\frac{${1}}{${2}}", "\\frac{a}{b}", "分数", 0),
    tpl("dfrac", "\\dfrac{${1}}{${2}}", "\\dfrac{a}{b}", "行内大分数", 12),
    tpl("tfrac", "\\tfrac{${1}}{${2}}", "\\tfrac{a}{b}", "行内小分数", 14),
    tpl("sqrt", "\\sqrt{${1}}", "\\sqrt{x}", "开平方", 10),
    tpl("sqrt[n]", "\\sqrt[${1}]{${2}}", "\\sqrt[n]{x}", "开 n 次方", 80),
    tpl("sum", "\\sum_{${1:i=1}}^{${2:n}}", "\\sum_{i=1}^{n}", "求和", 20),
    tpl("prod", "\\prod_{${1:i=1}}^{${2:n}}", "\\prod_{i=1}^{n}", "连乘", 60),
    tpl("int", "\\int_{${1:a}}^{${2:b}}", "\\int_{a}^{b}", "定积分", 30),
    tpl("iint", "\\iint_{${1:D}}", "\\iint_{D}", "二重积分", 105),
    tpl("oint", "\\oint_{${1:C}}", "\\oint_{C}", "环路积分", 107),
    tpl("lim", "\\lim_{${1:x} \\to ${2:0}}", "\\lim_{x \\to 0}", "极限", 40),
    tpl("binom", "\\binom{${1}}{${2}}", "\\binom{n}{k}", "组合数", 70),
    tpl("d/dx", "\\frac{d ${1}}{d ${2:x}}", "\\frac{dy}{dx}", "导数", 50),
    tpl("p/p", "\\frac{\\partial ${1}}{\\partial ${2:x}}", "\\frac{\\partial f}{\\partial x}", "偏导", 55),
    tpl("cases", "\\begin{cases} ${1} & ${2} \\\\ ${3} & ${4} \\end{cases}", "\\begin{cases} a & x>0 \\\\ b & x \\le 0 \\end{cases}", "分段函数", 90),
    tpl("bmatrix", "\\begin{bmatrix} ${1} & ${2} \\\\ ${3} & ${4} \\end{bmatrix}", "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", "方括号矩阵", 100),
    tpl("pmatrix", "\\begin{pmatrix} ${1} & ${2} \\\\ ${3} & ${4} \\end{pmatrix}", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "圆括号矩阵", 102),
    tpl("vmatrix", "\\begin{vmatrix} ${1} & ${2} \\\\ ${3} & ${4} \\end{vmatrix}", "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", "行列式", 104),
    tpl("aligned", "\\begin{aligned} ${1} &= ${2} \\\\ ${3} &= ${4} \\end{aligned}", "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}", "等号对齐", 110),
    tpl("overbrace", "\\overbrace{${1}}^{${2}}", "\\overbrace{x}^{n}", "上花括号", 130),
    tpl("underbrace", "\\underbrace{${1}}_{${2}}", "\\underbrace{x}_{n}", "下花括号", 132),

    // ================= 希腊字母（200~370） =================
    sym("alpha", "小写 α", "希腊", 200),
    sym("beta", "小写 β", "希腊", 205),
    sym("gamma", "小写 γ", "希腊", 210),
    sym("delta", "小写 δ", "希腊", 215),
    sym("epsilon", "小写 ϵ", "希腊", 220),
    sym("varepsilon", "小写 ε（变体）", "希腊", 222),
    sym("zeta", "小写 ζ", "希腊", 225),
    sym("eta", "小写 η", "希腊", 230),
    sym("theta", "小写 θ", "希腊", 235),
    sym("vartheta", "小写 ϑ（变体）", "希腊", 237),
    sym("iota", "小写 ι", "希腊", 240),
    sym("kappa", "小写 κ", "希腊", 245),
    sym("lambda", "小写 λ", "希腊", 250),
    sym("mu", "小写 μ", "希腊", 255),
    sym("nu", "小写 ν", "希腊", 260),
    sym("xi", "小写 ξ", "希腊", 265),
    sym("pi", "小写 π", "希腊", 270),
    sym("varpi", "小写 ϖ（变体）", "希腊", 272),
    sym("rho", "小写 ρ", "希腊", 275),
    sym("varrho", "小写 ϱ（变体）", "希腊", 277),
    sym("sigma", "小写 σ", "希腊", 280),
    sym("varsigma", "小写 ς（变体）", "希腊", 282),
    sym("tau", "小写 τ", "希腊", 285),
    sym("upsilon", "小写 υ", "希腊", 290),
    sym("phi", "小写 ϕ", "希腊", 295),
    sym("varphi", "小写 φ（变体）", "希腊", 297),
    sym("chi", "小写 χ", "希腊", 300),
    sym("psi", "小写 ψ", "希腊", 305),
    sym("omega", "小写 ω", "希腊", 310),
    sym("Gamma", "大写 Γ", "希腊", 340),
    sym("Delta", "大写 Δ", "希腊", 342),
    sym("Theta", "大写 Θ", "希腊", 344),
    sym("Lambda", "大写 Λ", "希腊", 346),
    sym("Xi", "大写 Ξ", "希腊", 348),
    sym("Pi", "大写 Π", "希腊", 350),
    sym("Sigma", "大写 Σ", "希腊", 352),
    sym("Upsilon", "大写 Υ", "希腊", 354),
    sym("Phi", "大写 Φ", "希腊", 356),
    sym("Psi", "大写 Ψ", "希腊", 358),
    sym("Omega", "大写 Ω", "希腊", 360),

    // ================= 运算与关系（400~510） =================
    sym("times", "乘 ×", "运算", 400),
    sym("div", "除 ÷", "运算", 402),
    sym("cdot", "点乘 ·", "运算", 404),
    sym("ast", "星 ∗", "运算", 406),
    sym("star", "五角星 ⋆", "运算", 408),
    sym("circ", "圆 ∘", "运算", 410),
    sym("bullet", "实心点 •", "运算", 412),
    sym("pm", "正负 ±", "运算", 414),
    sym("mp", "负正 ∓", "运算", 416),
    sym("oplus", "圈加 ⊕", "运算", 418),
    sym("ominus", "圈减 ⊖", "运算", 420),
    sym("otimes", "圈乘 ⊗", "运算", 422),
    sym("odot", "圈点 ⊙", "运算", 424),
    sym("cup", "并 ∪", "运算", 426),
    sym("cap", "交 ∩", "运算", 428),
    sym("setminus", "差集 ∖", "运算", 430),
    sym("wedge", "逻辑与 ∧", "运算", 432),
    sym("vee", "逻辑或 ∨", "运算", 434),
    sym("triangleq", "定义为 ≜", "关系", 438),
    sym("le", "小于等于 ≤", "关系", 440),
    sym("ge", "大于等于 ≥", "关系", 442),
    sym("ll", "远小于 ≪", "关系", 444),
    sym("gg", "远大于 ≫", "关系", 446),
    sym("neq", "不等于 ≠", "关系", 448),
    sym("equiv", "恒等 ≡", "关系", 450),
    sym("approx", "约等于 ≈", "关系", 452),
    sym("cong", "全等 ≅", "关系", 454),
    sym("simeq", "相似 ≃", "关系", 456),
    sym("sim", "相似 ~", "关系", 458),
    sym("propto", "正比于 ∝", "关系", 460),
    sym("mid", "整除 |", "关系", 462),
    sym("nmid", "不整除 ∤", "关系", 464),
    sym("perp", "垂直 ⊥", "关系", 466),
    sym("parallel", "平行 ∥", "关系", 468),
    sym("in", "属于 ∈", "关系", 470),
    sym("notin", "不属于 ∉", "关系", 472),
    sym("ni", "包含 ∋", "关系", 474),
    sym("subset", "真子集 ⊂", "关系", 476),
    sym("supset", "真超集 ⊃", "关系", 478),
    sym("subseteq", "子集 ⊆", "关系", 480),
    sym("supseteq", "超集 ⊇", "关系", 482),
    sym("prec", "前趋 ≺", "关系", 484),
    sym("succ", "后继 ≻", "关系", 486),
    sym("preceq", "前趋等于 ⪯", "关系", 488),
    sym("succeq", "后继等于 ⪰", "关系", 490),
    sym("models", "满足 ⊨", "关系", 492),
    sym("vdash", "推出 ⊢", "关系", 494),

    // ================= 箭头（520~565） =================
    sym("to", "右箭头 →", "箭头", 520),
    sym("gets", "左箭头 ←", "箭头", 522),
    sym("rightarrow", "右箭头 →", "箭头", 524),
    sym("leftarrow", "左箭头 ←", "箭头", 526),
    sym("mapsto", "映射 ↦", "箭头", 528),
    sym("longrightarrow", "长右箭头 ⟶", "箭头", 530),
    sym("longleftarrow", "长左箭头 ⟵", "箭头", 532),
    sym("Rightarrow", "推出 ⇒", "箭头", 534),
    sym("Leftarrow", "反推出 ⇐", "箭头", 536),
    sym("Leftrightarrow", "等价 ⇔", "箭头", 538),
    sym("leftrightarrow", "双向 ↔", "箭头", 540),
    sym("uparrow", "上箭头 ↑", "箭头", 542),
    sym("downarrow", "下箭头 ↓", "箭头", 544),
    sym("rightleftharpoons", "可逆 ⇌", "箭头", 546),
    // 可扩展箭头：上下都能塞文字，用两个锚点
    {
      cmd: "xrightarrow",
      body: "\\xrightarrow{${1}}",
      katex: "\\xrightarrow{f}",
      desc: "带字长箭头",
      cat: "箭头",
      w: 548,
      tpl: true,
    },
    {
      cmd: "xleftarrow",
      body: "\\xleftarrow{${1}}",
      katex: "\\xleftarrow{f}",
      desc: "带字左箭头",
      cat: "箭头",
      w: 549,
      tpl: true,
    },

    // ================= 大型运算符（580~595） =================
    sym("coprod", "余积 ∐", "大运算", 580),
    sym("bigcup", "大并 ⋃", "大运算", 582),
    sym("bigcap", "大交 ⋂", "大运算", 584),
    sym("bigvee", "大或 ⋁", "大运算", 586),
    sym("bigwedge", "大与 ⋀", "大运算", 588),
    sym("bigoplus", "大圈加 ⨁", "大运算", 590),
    sym("bigotimes", "大圈乘 ⨂", "大运算", 592),

    // ================= 修饰（640~675） =================
    arg("hat", "尖角符 x̂", "x", 640),
    arg("widehat", "宽尖角符", "abc", 642),
    arg("tilde", "波浪符 x̃", "x", 644),
    arg("widetilde", "宽波浪符", "abc", 646),
    arg("bar", "上横线 x̄", "x", 648),
    arg("overline", "长上划线", "abc", 650),
    arg("underline", "下划线", "abc", 652),
    arg("vec", "向量箭头", "v", 654),
    arg("dot", "一点 ẋ", "x", 656),
    arg("ddot", "两点 ẍ", "x", 658),
    arg("dddot", "三点", "x", 660),
    arg("overrightarrow", "长右箭头", "AB", 662),
    arg("overleftarrow", "长左箭头", "AB", 664),
    arg("cancel", "删除线", "x", 666),

    // ================= 字母样式（700~725） =================
    arg("mathbf", "粗体", "A", 700),
    arg("mathit", "斜体", "A", 702),
    arg("mathrm", "正体", "A", 704),
    arg("mathsf", "无衬线", "A", 706),
    arg("mathtt", "等宽", "A", 708),
    arg("mathbb", "黑板体 ℝ", "R", 710),
    arg("mathcal", "花体", "A", 712),
    arg("mathfrak", "哥特体", "A", 714),
    arg("boldsymbol", "加粗（含希腊字母）", "\\alpha", 716),
    arg("text", "正文（含空格）", "文字", 718),
    arg("textbf", "加粗正文", "文字", 720),
    arg("textit", "斜体正文", "文字", 722),

    // ================= 集合与逻辑（740~770） =================
    sym("forall", "任意 ∀", "逻辑", 740),
    sym("exists", "存在 ∃", "逻辑", 742),
    sym("nexists", "不存在 ∄", "逻辑", 744),
    sym("emptyset", "空集 ∅", "逻辑", 746),
    sym("varnothing", "空集（变体）", "逻辑", 748),
    sym("neg", "非 ¬", "逻辑", 750),
    sym("lnot", "非 ¬", "逻辑", 752),
    sym("top", "真 ⊤", "逻辑", 754),
    sym("bot", "假 ⊥", "逻辑", 756),
    sym("therefore", "所以 ∴", "逻辑", 758),
    sym("because", "因为 ∵", "逻辑", 760),
    sym("land", "且 ∧", "逻辑", 762),
    sym("lor", "或 ∨", "逻辑", 764),

    // ================= 定界符（780~800） =================
    sym("langle", "左尖括号 ⟨", "定界", 780),
    sym("rangle", "右尖括号 ⟩", "定界", 782),
    sym("lceil", "左向上取整 ⌈", "定界", 784),
    sym("rceil", "右向上取整 ⌉", "定界", 786),
    sym("lfloor", "左向下取整 ⌊", "定界", 788),
    sym("rfloor", "右向下取整 ⌋", "定界", 790),
    sym("lvert", "左竖线", "定界", 792),
    sym("rvert", "右竖线", "定界", 794),
    sym("lVert", "左双竖线", "定界", 796),
    sym("rVert", "右双竖线", "定界", 798),

    // ================= 杂项（800~845） =================
    sym("infty", "无穷 ∞", "杂项", 800),
    sym("partial", "偏微分 ∂", "杂项", 802),
    sym("nabla", "倒三角 ∇", "杂项", 804),
    sym("cdots", "居中省略号 ⋯", "杂项", 806),
    sym("ldots", "基线省略号 …", "杂项", 808),
    sym("vdots", "竖省略号 ⋮", "杂项", 810),
    sym("ddots", "斜省略号 ⋱", "杂项", 812),
    sym("angle", "角 ∠", "杂项", 814),
    sym("triangle", "三角形 △", "杂项", 816),
    sym("square", "正方形 □", "杂项", 818),
    sym("diamond", "菱形 ◇", "杂项", 820),
    sym("hbar", "约化普朗克 ħ", "杂项", 822),
    sym("ell", "花体 ℓ", "杂项", 824),
    sym("Re", "实部 ℜ", "杂项", 826),
    sym("Im", "虚部 ℑ", "杂项", 828),
    sym("aleph", "阿列夫 ℵ", "杂项", 830),
    sym("wp", "外尔斯特拉斯 ℘", "杂项", 832),
    sym("prime", "撇 ′", "杂项", 834),

    // ================= 空格（900~905） =================
    sym("quad", "1em 空格", "空格", 900),
    sym("qquad", "2em 空格", "空格", 902),
    sym("thinspace", "窄空格", "空格", 904),

    // ================= 函数名（940~995） =================
    fn("sin", "正弦", 940),
    fn("cos", "余弦", 942),
    fn("tan", "正切", 944),
    fn("cot", "余切", 946),
    fn("sec", "正割", 948),
    fn("csc", "余割", 950),
    fn("arcsin", "反正弦", 952),
    fn("arccos", "反余弦", 954),
    fn("arctan", "反正切", 956),
    fn("sinh", "双曲正弦", 958),
    fn("cosh", "双曲余弦", 960),
    fn("tanh", "双曲正切", 962),
    fn("log", "对数", 964),
    fn("ln", "自然对数", 966),
    fn("lg", "常用对数", 968),
    fn("exp", "指数", 970),
    fn("min", "最小值", 972),
    fn("max", "最大值", 974),
    fn("arg", "辐角", 976),
    fn("deg", "角度", 978),
    fn("det", "行列式", 980),
    fn("gcd", "最大公约数", 982),
    fn("inf", "下确界", 984),
    fn("sup", "上确界", 986),
    fn("ker", "核", 988),
    fn("dim", "维数", 990),
    fn("hom", "同态", 992),
    fn("Pr", "概率", 994),
  ];
})();
