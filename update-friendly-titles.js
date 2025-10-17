// update-friendly-titles.js
// Atualiza o metafield custom.friendly_title_first_line com a 1ª linha da descrição

import fetch from "node-fetch";

// ← ajuste aqui se quiser mudar via Actions (mas já deixei seu domínio como padrão)
const SHOP = process.env.SHOP_DOMAIN || "xz5315-nz.myshopify.com";
const API_VERSION = process.env.API_VERSION || "2024-10";
const TOKEN = process.env.TOKEN; // GH Secret SHOP_ADMIN_API_TOKEN
const MF_NAMESPACE = process.env.MF_NAMESPACE || "custom";
const MF_KEY = process.env.MF_KEY || "friendly_title_first_line";

if (!TOKEN) {
  throw new Error("Faltou o TOKEN (SHOP_ADMIN_API_TOKEN) nos secrets.");
}

const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = {
  "Content-Type": "application/json",
  "X-Shopify-Access-Token": TOKEN,
};

// ⚠️ Query correta: usa metafield (singular), sem keys/withDefinitions
const LIST_PRODUCTS = `
  query ListProducts($cursor: String) {
    products(first: 100, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          description
          metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") {
            id
            value
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

const SET_METAFIELD = `
  mutation SetMeta($ownerId: ID!, $namespace: String!, $key: String!, $value: String!) {
    metafieldsSet(
      metafields: [{
        ownerId: $ownerId,
        namespace: $namespace,
        key: $key,
        type: "single_line_text_field",
        value: $value
      }]
    ) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    // Deixa claro no log o erro retornado pelo GraphQL
    console.error(JSON.stringify(json.errors, null, 2));
    throw new Error("GraphQL top-level errors");
  }
  return json.data;
}

async function* productsIterator() {
  let cursor = null;
  while (true) {
    const data = await gql(LIST_PRODUCTS, { cursor });
    const edges = data.products.edges || [];
    for (const edge of edges) yield edge.node;
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
}

function firstLineFromDescription(html) {
  if (!html) return "";
  // tira tags html e pega a primeira linha não vazia
  const text = html
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  // “primeira linha” = até o primeiro ponto final ou quebra “forte”
  const byBreak = text.split(/[\r\n]+/)[0];
  const byDot = byBreak.split(". ")[0];
  return (byDot || byBreak).trim();
}

async function run() {
  let touched = 0;
  for await (const p of productsIterator()) {
    const current = p.metafield?.value || "";
    const candidate = firstLineFromDescription(p.description);

    // se não tem nada pra salvar, pula
    if (!candidate) continue;

    // se já está igual, pula
    if (current && current.trim() === candidate.trim()) continue;

    const result = await gql(SET_METAFIELD, {
      ownerId: p.id,
      namespace: MF_NAMESPACE,
      key: MF_KEY,
      value: candidate,
    });

    const errs = result.metafieldsSet.userErrors || [];
    if (errs.length) {
      console.warn(`⚠️ ${p.id} (${p.title}) — userErrors:`, errs);
      continue;
    }
    touched++;
    console.log(`✅ Atualizado: ${p.title} → "${candidate}"`);
  }
  console.log(`\n✔️ Finalizado. Produtos atualizados: ${touched}`);
}

run().catch((e) => {
  console.error("❌ Falhou:", e.message);
  process.exit(1);
});
