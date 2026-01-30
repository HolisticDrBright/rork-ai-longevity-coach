export interface AffiliateLink {
  name: string;
  url: string;
  discountCode?: string;
  discountAmount?: string;
  keywords: string[];
  category: 'supplements' | 'peptides' | 'detox' | 'gut' | 'sleep' | 'devices' | 'water' | 'air' | 'emf' | 'general';
}

export const AFFILIATE_LINKS: AffiliateLink[] = [
  // General Supplements - FullScript (default for most supplements)
  {
    name: 'FullScript',
    url: 'https://us.fullscript.com/welcome/drbright/signup',
    keywords: ['magnesium', 'fish oil', 'omega-3', 'vitamin d', 'vitamin c', 'vitamin b', 'b12', 'b6', 'folate', 'zinc', 'selenium', 'iron', 'calcium', 'potassium', 'coq10', 'probiotics', 'digestive enzymes', 'multivitamin', 'vitamin e', 'vitamin a', 'vitamin k', 'chromium', 'berberine', 'curcumin', 'turmeric', 'resveratrol', 'quercetin', 'nac', 'n-acetyl cysteine', 'alpha lipoic acid', 'ala', 'acetyl l-carnitine', 'l-carnitine', 'taurine', 'glycine', 'l-theanine', 'gaba', 'ashwagandha', 'rhodiola', 'holy basil', 'adaptogen', 'adrenal support', 'thyroid support', 'liver support', 'methylfolate', 'methylcobalamin', 'sam-e', 'tmg', 'betaine', 'choline', 'inositol', 'dha', 'epa', 'krill oil', 'cod liver oil', 'vitamin', 'mineral', 'supplement'],
    category: 'supplements',
  },
  
  // D-Spiked
  {
    name: 'D-Spiked',
    url: 'https://dspiked.com/',
    keywords: ['d-spiked', 'spike protein', 'detox spike'],
    category: 'detox',
  },
  
  // CellCore
  {
    name: 'CellCore',
    url: 'https://cellcore.com/collections/products',
    discountCode: 'HQ91SbRn',
    keywords: ['cellcore', 'binder', 'biotoxin', 'carboxy', 'para kit', 'drainage', 'mimosa pudica', 'tudca'],
    category: 'detox',
  },
  
  // VerVita
  {
    name: 'VerVita',
    url: 'https://vervitaproducts.com/?ref=drbrandonbright',
    keywords: ['vervita'],
    category: 'supplements',
  },
  
  // Supreme Nutrition
  {
    name: 'Supreme Nutrition',
    url: 'https://shop.supremenutritionproducts.com?aff=47',
    keywords: ['supreme nutrition', 'morinda', 'takesumi', 'melia', 'samento', 'banderol'],
    category: 'supplements',
  },
  
  // DSS Supplements
  {
    name: 'DSS Supplements',
    url: 'https://www.dssorders.com/dnswcustadminlogin.asp',
    discountCode: 'BB3606',
    keywords: ['dss', 'drainage', 'homeopathic'],
    category: 'supplements',
  },
  
  // Healthgevity
  {
    name: 'Healthgevity',
    url: 'https://healthgev.com/?rfsn=7188917.246a77',
    keywords: ['healthgevity', 'longevity'],
    category: 'supplements',
  },
  
  // Profound Health Bioregulators
  {
    name: 'Profound Health Bioregulators',
    url: 'https://profound-health.com/?Aff=BRIGHT',
    keywords: ['bioregulator', 'peptide bioregulator', 'khavinson'],
    category: 'peptides',
  },
  
  // StemRegen
  {
    name: 'StemRegen',
    url: 'https://www.stemregen.co/discount/918E5656?redirect=%2Fproducts%2Fstemregen%2F%3Fafmc%3D918E5656',
    discountCode: '918E5656',
    keywords: ['stemregen', 'stem cell', 'stem cells'],
    category: 'supplements',
  },
  
  // Organifi
  {
    name: 'Organifi',
    url: 'https://www.organifishop.com/collections/all-products?oid=18&affid=1211',
    keywords: ['organifi', 'green juice', 'red juice', 'gold'],
    category: 'supplements',
  },
  
  // Fatty15
  {
    name: 'Fatty15',
    url: 'https://fatty15.com/DRBRIGHT',
    discountCode: 'DRBRIGHT',
    keywords: ['fatty15', 'c15', 'pentadecanoic acid', 'fatty 15'],
    category: 'supplements',
  },
  
  // MitoZen
  {
    name: 'MitoZen',
    url: 'https://www.mitozen.club/?ref=iubtbofq',
    discountCode: 'DRBRIGHT',
    discountAmount: '5% off',
    keywords: ['mitozen', 'suppository', 'glutathione suppository', 'nad suppository'],
    category: 'supplements',
  },
  
  // Bioray (Kids Formulas)
  {
    name: 'Bioray',
    url: 'https://bioray-inc.myshopify.com?aff=738',
    keywords: ['bioray', 'kids formula', 'children', 'liver life', 'cytoflora'],
    category: 'supplements',
  },
  
  // Auro Wellness (Transdermal Glutathione)
  {
    name: 'Auro Wellness',
    url: 'https://aurowellness.com/',
    keywords: ['auro', 'transdermal glutathione', 'glutathione spray', 'gsh'],
    category: 'supplements',
  },
  
  // LVLUp Health
  {
    name: 'LVLUp Health',
    url: 'https://lvluphealth.com/BRANDONBRIGHT',
    discountCode: 'HOLISTICDRBRIGHT',
    discountAmount: '15% off',
    keywords: ['lvlup', 'level up'],
    category: 'supplements',
  },
  
  // Kill Switch Sleep Formula
  {
    name: 'Kill Switch Sleep',
    url: 'https://www.switchsupplements.com/BRANDON',
    discountCode: 'BRANDON',
    keywords: ['kill switch', 'sleep formula', 'sleep supplement', 'switch supplements'],
    category: 'sleep',
  },
  
  // Fringe
  {
    name: 'Fringe',
    url: 'https://fringeheals.com/ref/224/',
    keywords: ['fringe', 'methylene blue'],
    category: 'supplements',
  },
  
  // MitoPure (Timeline)
  {
    name: 'MitoPure',
    url: 'https://www.timeline.com/shop?rfsn=8540377.cd4d97b',
    discountCode: 'DRBRIGHT',
    keywords: ['mitopure', 'urolithin', 'urolithin a', 'timeline'],
    category: 'supplements',
  },
  
  // Cosmic Nootropics
  {
    name: 'Cosmic Nootropics',
    url: 'https://cosmicnootropic.com/?coupon-code=443',
    discountCode: 'DrBright',
    keywords: ['cosmic nootropic', 'nootropic', 'semax', 'selank', 'cerebrolysin', 'cortexin'],
    category: 'peptides',
  },
  
  // Wizard Sciences
  {
    name: 'Wizard Sciences',
    url: 'https://wizardsciences.com/?rfsn=8541067.1c232d&utm_source=refersion&utm_medium=affiliate&utm_campaign=8541067.1c232d',
    discountCode: 'DRBRIGHT',
    keywords: ['wizard sciences', 'rapamycin'],
    category: 'supplements',
  },
  
  // Integrative Peptides
  {
    name: 'Integrative Peptides',
    url: 'https://integrativepeptides.com/store/affiliate/drbright/',
    keywords: ['integrative peptides', 'bpc-157', 'bpc', 'tb-500', 'tb500', 'kpv', 'peptide'],
    category: 'peptides',
  },
  
  // COHN Hydrogen
  {
    name: 'COHN Nutrition',
    url: 'https://cohnnutrition.com/?coupon-code=welcome-10&ref=272',
    keywords: ['cohn', 'hydrogen', 'molecular hydrogen', 'h2'],
    category: 'supplements',
  },
  
  // Calroy Supplements
  {
    name: 'Calroy',
    url: 'https://theholisticapproach.calroy.com/',
    keywords: ['calroy'],
    category: 'supplements',
  },
  
  // Vital BPC Peptides
  {
    name: 'Vital BPC',
    url: 'https://vitalbpc157.com/?ref=cwprbuhb',
    keywords: ['vital bpc', 'bpc-157', 'bpc 157'],
    category: 'peptides',
  },
  
  // Asea
  {
    name: 'Asea',
    url: 'https://1800853812.myasealive.com/',
    keywords: ['asea', 'redox', 'redox signaling'],
    category: 'supplements',
  },
  
  // Prodrome Plasmalagens
  {
    name: 'Prodrome',
    url: 'https://prodrome.com/bgngbhve',
    discountCode: 'BRIGHT25',
    discountAmount: '25% off',
    keywords: ['prodrome', 'plasmalogen', 'plasmalogens'],
    category: 'supplements',
  },
  
  // CBD - Jones Meadows
  {
    name: 'Jones Meadows CBD',
    url: 'https://www.jonesmeadows.com/?ref=BRANDONBRIGHT',
    keywords: ['cbd', 'cannabidiol', 'hemp'],
    category: 'supplements',
  },
  
  // Branch Basics
  {
    name: 'Branch Basics',
    url: 'https://branchbasics.com/HOLISTICDRBRIGHT',
    discountCode: 'HOLISTICDRBRIGHT',
    discountAmount: '15% off',
    keywords: ['branch basics', 'cleaning', 'non-toxic cleaning'],
    category: 'general',
  },
  
  // SOTA Bob Beck Devices
  {
    name: 'SOTA',
    url: 'https://www.sota.com/',
    discountCode: 'CA103625',
    keywords: ['sota', 'bob beck', 'bio tuner', 'magnetic pulser', 'silver pulser'],
    category: 'devices',
  },
  
  // VitaChip EMF
  {
    name: 'VitaChip',
    url: 'https://vitachipus.com?sca_ref=6075914.XKpN6CxbpEi3HqY',
    discountCode: 'BRANDON10',
    keywords: ['vitachip', 'emf', 'emf protection', 'emf blocker'],
    category: 'emf',
  },
  
  // Super Teeth
  {
    name: 'Super Teeth',
    url: 'https://getsuperteeth.com/?ref=bwadrrdw',
    keywords: ['super teeth', 'dental', 'teeth', 'oral health'],
    category: 'general',
  },
  
  // Jernigan Nutraceuticals
  {
    name: 'Jernigan Nutraceuticals',
    url: 'https://www.jnutra.com/?aff=204',
    keywords: ['jernigan', 'borrelogen', 'lyme'],
    category: 'supplements',
  },
  
  // Nutrisense CGM
  {
    name: 'Nutrisense',
    url: 'https://www.nutrisense.io/?rfsn=8310553.fab605&utm_source=affiliate&utm_medium=referral&utm_campaign=HolisticDrBright&utm_term=8310553.fab605&code=DrBright',
    discountCode: 'DrBright',
    keywords: ['nutrisense', 'cgm', 'continuous glucose', 'glucose monitor'],
    category: 'devices',
  },
  
  // Castor Oil Packs - Queen of Thrones
  {
    name: 'Queen of Thrones',
    url: 'https://affiliatestore.shopqueenofthethrones.com/BRANDONBRIGHT',
    keywords: ['castor oil', 'castor pack', 'queen of thrones'],
    category: 'detox',
  },
  
  // Ryze Mushroom Coffee
  {
    name: 'Ryze',
    url: 'https://www.ryzesuperfoods.com/products/mushroom-hot-cocoa?ref=BRANDONBRIGHT',
    discountCode: 'DRBRIGHT15',
    discountAmount: '15% off',
    keywords: ['ryze', 'mushroom coffee', 'mushroom cocoa', 'lions mane', 'reishi', 'chaga', 'cordyceps'],
    category: 'supplements',
  },
  
  // Shilajit
  {
    name: 'Natural Shilajit',
    url: 'https://naturalshilajit.com/discount/BRIGHT10',
    discountCode: 'BRIGHT10',
    keywords: ['shilajit', 'fulvic acid', 'humic acid'],
    category: 'supplements',
  },
  
  // Earthing/Grounding
  {
    name: 'Premium Grounding',
    url: 'https://premiumgrounding.au/?ref=tysruhri',
    keywords: ['grounding sheet', 'earthing sheet'],
    category: 'devices',
  },
  {
    name: 'Earthing',
    url: 'https://www.earthing.com/?rfsn=7887588.611dbf&utm_source=refersion&utm_medium=affiliate&utm_campaign=7887588.611dbf',
    keywords: ['earthing', 'grounding', 'grounding mat'],
    category: 'devices',
  },
  
  // Matula Tea
  {
    name: 'Matula Tea',
    url: 'https://www.matulatea.com/#a_aid=DrBright',
    keywords: ['matula', 'h pylori', 'helicobacter'],
    category: 'gut',
  },
  
  // Body Bio
  {
    name: 'BodyBio',
    url: 'https://bodybio.com/?ref=holisticdrbright',
    keywords: ['bodybio', 'pc', 'phosphatidylcholine', 'butyrate', 'sodium butyrate'],
    category: 'supplements',
  },
  
  // ION Layer NAD+ Patches
  {
    name: 'ION Layer',
    url: 'https://www.ionlayer.com/?rfsn=7400949.6c2c60',
    discountCode: 'DrBright',
    discountAmount: '$100 off',
    keywords: ['ion layer', 'nad patch', 'nad+ patch', 'iontophoresis'],
    category: 'supplements',
  },
  
  // Leela Quantum Tech
  {
    name: 'Leela Quantum',
    url: 'https://leelaq.com/?ref=DrBright',
    keywords: ['leela quantum', 'quantum', 'quantum technology'],
    category: 'devices',
  },
  
  // SRT Light
  {
    name: 'CRA Wellness SRT',
    url: 'https://crawellness.com/DrBrandonBright',
    keywords: ['srt', 'light therapy', 'scalar'],
    category: 'devices',
  },
  
  // Analemma Water
  {
    name: 'Analemma',
    url: 'https://analemma-water.com/#a_aid=DrBright',
    keywords: ['analemma', 'structured water', 'coherent water'],
    category: 'water',
  },
  
  // AquaSana
  {
    name: 'AquaSana',
    url: 'https://click.linksynergy.com/link?id=c7l5OMNy1gM&offerid=1108576.366673859077374&type=2&murl=https%3a%2f%2fwww.aquasana.com%2fwhole-house-water-filters%2frhino-chloramines%2ftall-salt-free-water-conditioner-100365049.html%3fdiscountcode%3dLS',
    keywords: ['aquasana', 'water filter', 'whole house filter'],
    category: 'water',
  },
  
  // AirDoctor
  {
    name: 'AirDoctor',
    url: 'https://www.airdoctorpro.com/?oid=17&affid=4076&c=holisticdrbright',
    keywords: ['airdoctor', 'air purifier', 'air filter', 'hepa'],
    category: 'air',
  },
  
  // AquaTru
  {
    name: 'AquaTru',
    url: 'https://aquatruwater.com/?oid2=50&affid2=4076&c=holisticdrbright',
    keywords: ['aquatru', 'reverse osmosis', 'ro water', 'water purifier'],
    category: 'water',
  },
  
  // AromaTru
  {
    name: 'AromaTru',
    url: 'https://aromatruorganics.com/?oid5=70&affid5=4076&c=holisticdrbright',
    keywords: ['aromatru', 'essential oil', 'diffuser', 'aromatherapy'],
    category: 'general',
  },
  
  // BonCharge
  {
    name: 'BonCharge',
    url: 'https://boncharge.com/?rfsn=7169636.8c4193',
    keywords: ['boncharge', 'blue light', 'blue light blocking', 'red light', 'infrared', 'sauna blanket'],
    category: 'devices',
  },
  
  // Vesla Copper Water Bottle
  {
    name: 'Vesla Copper',
    url: 'https://www.veslacopper.com/brandonbright29',
    keywords: ['vesla', 'copper water', 'copper bottle'],
    category: 'water',
  },
  
  // Superstratum Mold Cleaner
  {
    name: 'Superstratum',
    url: 'https://superstratum.shop/pages/products-slider?rfsn=7497987.a87b3e&utm_source=refersion&utm_medium=affiliate',
    keywords: ['superstratum', 'mold cleaner', 'mold spray', 'shower cleaner'],
    category: 'detox',
  },
  
  // Food Grade Hydrogen Peroxide (Amazon)
  {
    name: 'Hydrogen Peroxide (Amazon)',
    url: 'https://amzn.to/3FhflGR',
    keywords: ['hydrogen peroxide', 'food grade hydrogen peroxide', 'h2o2'],
    category: 'general',
  },
  
  // Artichoke Extract (Amazon)
  {
    name: 'Artichoke Extract (Amazon)',
    url: 'https://amzn.to/3ZTNAg5',
    keywords: ['artichoke', 'artichoke extract', 'bile flow'],
    category: 'supplements',
  },
];

export const DEFAULT_SUPPLEMENT_LINK: AffiliateLink = {
  name: 'FullScript',
  url: 'https://us.fullscript.com/welcome/drbright/signup',
  keywords: [],
  category: 'supplements',
};

export const IG_LINK = 'https://theholisticapproach.clickfunnels.com/squeeze-page?fbclid=PAAaanvqa79TocdjkpxaOgux9AEVVhFeVByvnbMSGbSDfayMbnEpIYJ31KMMA';

export function findAffiliateLink(productName: string): AffiliateLink {
  const lowerName = productName.toLowerCase();
  
  for (const link of AFFILIATE_LINKS) {
    for (const keyword of link.keywords) {
      if (lowerName.includes(keyword.toLowerCase())) {
        return link;
      }
    }
  }
  
  return DEFAULT_SUPPLEMENT_LINK;
}

export function getAffiliateLinksByCategory(category: AffiliateLink['category']): AffiliateLink[] {
  return AFFILIATE_LINKS.filter(link => link.category === category);
}
