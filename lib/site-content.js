const DEFAULT_SITE_CONTENT = {
  hero: {
    eyebrow: "LYSTRO SHOE CARE • ADDIS ABABA",
    title: "ጫማዎ ንጹህ ሲሆን፣",
    highlight: "የእርስዎ ውበት ይጨምራል!",
    description: "ንጽህናን፣ ውበትን እና ምቾትን ከቤትዎ ሳይወጡ ያግኙ። ጫማዎን በባለሙያ እንንከባከብልዎ!",
    ctaLabel: "🚀 አገልግሎት ያስይዙ →"
  },
  nav: [
    { label: "Home", href: "#", enabled: true },
    { label: "Our Services⌄", href: "#services", enabled: true },
    { label: "Before & After", href: "#before", enabled: true },
    { label: "Shoe Care Tips", href: "#tips", enabled: true },
    { label: "Why LYSTRO?", href: "#why", enabled: true },
    { label: "Reviews", href: "#reviews", enabled: true },
    { label: "Contact", href: "#contact", enabled: true }
  ],
  footer: [
    { label: "Home", href: "#", enabled: true },
    { label: "Services", href: "#services", enabled: true },
    { label: "About", href: "#why", enabled: true },
    { label: "Shoe Care Tips", href: "#tips", enabled: true },
    { label: "Contact", href: "mailto:info@lystro.com", enabled: true }
  ],
  services: [
    { title: "Basic Shoe Cleaning", description: "የዕለት ተዕለት ቆሻሻን በጥንቃቄ ማጽዳት።", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&q=80&auto=format&fit=crop", enabled: true },
    { title: "Deep Cleaning", description: "ለጥልቅ ቆሻሻ የተሻለ የጽዳት እንክብካቤ።", image: "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=900&q=80&auto=format&fit=crop", enabled: true },
    { title: "Premium Shoe Care", description: "ለጫማዎ ልዩ ትኩረትና የተሟላ እንክብካቤ።", image: "https://images.unsplash.com/photo-1495555961986-6d4c1ecb7be3?w=900&q=80&auto=format&fit=crop", enabled: true }
  ],
  beforeAfter: [
    { title: "Everyday Sneaker Refresh", description: "የምሳሌ ማሳያ ብቻ — እውነተኛ የደንበኛ ውጤት አይደለም።", beforeImage: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&q=80&auto=format&fit=crop", afterImage: "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=900&q=80&auto=format&fit=crop", enabled: true },
    { title: "Fresh Shoe Care", description: "የምሳሌ ማሳያ ብቻ — እውነተኛ የደንበኛ ውጤት አይደለም።", beforeImage: "https://images.unsplash.com/photo-1495555961986-6d4c1ecb7be3?w=900&q=80&auto=format&fit=crop", afterImage: "https://images.unsplash.com/photo-1520256862855-398228c41684?w=900&q=80&auto=format&fit=crop", enabled: true }
  ],
  sections: { services: true, before: true, tips: true, why: true, reviews: true }
};
function cleanSiteContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Website content must be a JSON object.");
  const json = JSON.stringify(value);
  if (json.length > 50000) throw new Error("Website content is too large (maximum 50 KB).");
  const safeText = (v, max=500) => typeof v === "string" ? v.trim().slice(0,max) : "";
  const safeHref = v => {
    const s=safeText(v,500);
    return s.startsWith("#") || /^https:\/\//i.test(s) || /^mailto:[^\s]+$/i.test(s) ? s : "#";
  };
  const safeImage = v => /^https:\/\//i.test(safeText(v,1000)) ? safeText(v,1000) : "";
  const list = (items, mapper, max) => Array.isArray(items) ? items.slice(0,max).map(mapper) : [];
  const d=value;
  return {
    hero: { eyebrow:safeText(d.hero?.eyebrow,100), title:safeText(d.hero?.title,160), highlight:safeText(d.hero?.highlight,160), description:safeText(d.hero?.description,600), ctaLabel:safeText(d.hero?.ctaLabel,100) },
    nav:list(d.nav,x=>({label:safeText(x?.label,60),href:safeHref(x?.href),enabled:x?.enabled!==false}),12),
    footer:list(d.footer,x=>({label:safeText(x?.label,60),href:safeHref(x?.href),enabled:x?.enabled!==false}),12),
    services:list(d.services,x=>({title:safeText(x?.title,100),description:safeText(x?.description,500),image:safeImage(x?.image),enabled:x?.enabled!==false}),12),
    beforeAfter:list(d.beforeAfter,x=>({title:safeText(x?.title,100),description:safeText(x?.description,500),beforeImage:safeImage(x?.beforeImage),afterImage:safeImage(x?.afterImage),enabled:x?.enabled!==false}),8),
    sections:{services:d.sections?.services!==false,before:d.sections?.before!==false,tips:d.sections?.tips!==false,why:d.sections?.why!==false,reviews:d.sections?.reviews!==false}
  };
}
module.exports = { DEFAULT_SITE_CONTENT, cleanSiteContent };
