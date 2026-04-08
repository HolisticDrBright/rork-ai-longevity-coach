# AI Longevity Pro — Protocol Index & Authoring Guide

> This document serves as the master index for all internal protocols and provides a template for creating new ones.

## Current Protocols

| Migration | Category | Entry Count | Source |
|---|---|---|---|
| `013_oat_protocol.sql` | Lab Interpretation | ~85 biomarkers across 6 categories | Organic Acid Test (OAT) |
| `014_oxidative_stress_protocol.sql` | Lab Interpretation + Nutrigenomics | 16 markers + 24 SNPs | Oxidative Stress Panel + SNPs |
| `015_supplement_catalog.sql` | Product Recommendations + Affiliate Links | 91 products across 16 categories | Dr. Bright's Supplement Catalog |
| `016_vaccine_injury_protocols.sql` | Condition-Specific Treatment | 8 mechanisms + 6 phenotypes | mRNA Vaccine Injury |
| `017_clinical_protocols.sql` | Clinical Decision Engine | 4 levels + 15 condition protocols + 8 anchor products | Clinical Protocol Logic |

## How the Protocol System Works

### 4-Level Supplement Progression

**Level 1 — Foundational:** MitoCore, Protect+10, Fish oil, Magnesium. Start here before adding anything.

**Level 2 — Terrain Correction:** Address the dominant pattern with Resolve+, Ignite+, NAC, glutathione, colostrum, liver/bile support based on findings.

**Level 3 — Driver-Specific:** Target root causes: mold, Lyme, parasites, hormones, blood sugar, metals, viral load.

**Level 4 — Optimization:** Prime Time+, Urolithin A, mitochondrial support, peptides, hormone refinement. Only when foundation is solid.

### Anchor Products by Concern

| Concern | Anchor Product |
|---|---|
| Blood sugar / weight loss resistance | Ignite+ |
| Inflammation / pain / autoimmune terrain | Resolve+ |
| Micronutrient + mitochondrial base | MitoCore |
| Immune + D/K/A/E support | Protect+10 |
| Oxidative stress / detox | NAC + Glutathione |
| Barrier / gut resilience | Colostrum (bioREPAIR) |
| Mitochondrial upgrade | Urolithin A / MitoBlue / Prime Time+ |
| Hormone optimization | Core Hormone Support / DHEA (only after sleep, blood sugar, inflammation, and detox addressed) |

### tRPC Endpoints

- `clinicalProtocols.getLevels` — 4-level progression
- `clinicalProtocols.getAnchorProducts` — which product leads for which concern
- `clinicalProtocols.getAll` — all 15 condition protocols
- `clinicalProtocols.getProtocol(name)` — full protocol with products and decision logic
- `clinicalProtocols.search(query)` — search by symptoms
- `clinicalProtocols.matchBySymptoms(symptoms[])` — ranked protocol matching
- `clinicalProtocols.getFoundationalStack` — Level 1 products across all protocols
- `productCatalog.matchByKeywords(keywords[])` — match supplements to affiliate products
- `oatProtocol.getInterpretation(name, direction)` — OAT biomarker lookup
- `oxidativeStress.getBiomarker(name)` — oxidative stress marker lookup
- `oxidativeStress.getSnp(geneName)` — SNP nutrient support lookup
- `vaccineInjury.getByType(type)` — mechanism or phenotype protocols

## Template for Creating New Protocols

### Lab Interpretation Protocol

```markdown
### [Biomarker Name] — [High/Low]

- **Clinical Significance:** [What this finding indicates]
- **Lifestyle Recommendations:** [Diet, exercise, environmental changes]
- **Supplement Protocol:** [Supplements with specific doses]
- **Additional Considerations:** [Peptides, prescriptions, special notes]
- **Recommended Lab Follow-up:** [Tests to order]
- **Clinical Pearl:** [Key clinical insight]
```

### Condition-Specific Protocol

```markdown
## [Condition Name]
Use when: [symptoms, patterns, lab findings]

Products:
- [Product] — [Role/when to use] (Level 1-4)

Decision Logic:
- If [condition], first choice: [product]
- If [condition], add: [product]
- Note: [clinical guidance]
```

### SNP Protocol

```markdown
## [Gene Name]
- **Wild Type:** [Genotype]
- **Heterozygous Variant:** [Genotype]
- **Homozygous Variant:** [Genotype]
- **Nutrient Support:** [Targeted supplements]
```

## Naming Convention

Migration files: `0XX_protocol_[name].sql`
Router files: `routes/[protocolName].ts`
