// update-friendly-titles.js
import fetch from 'node-fetch';

const TOKEN = process.env.TOKEN;
const API_VERSION = process.env.API_VERSION || '2024-10';
const STORE = 'xz5315-nz.myshopify.com'; // seu domínio
const MF_NAMESPACE = process.env.MF_NAMESPACE || 'custom';
const MF_KEY = process.env.MF_KEY || 'friendly_title_first_line';

// helpers
async function shopifyGraphQL(query, variables) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  // Log detalhado em caso de erro HTTP
  if (!res.ok) {
    const text = await res.text();
    const msg = `HTTP ${res.status} ${res.statusText}\nURL: ${url}\nResponse:\n${text}`;
    throw new Error(msg);
  }

  const data = await res.json();

  if (data.errors) {
    throw new Error('GraphQL top-level errors: ' + JSON.stringify(data.errors, null, 2));
  }
  return data.data;
}

// queries/mutations
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
  mutation SetMetafield($ownerId: ID!, $value: String!) {
    metafieldsSet(metafields: [{
      ownerId: $ownerId,
      namespace: "${MF_NAMESPACE}",
      key: "${MF_KEY}",
      type: "single_line_text_field",
      value: $value
    }]) {
      userErrors { field message }
      metafields { id }
    }
  }
`;

// pegar primeira linha amigável
function firstLineFromDescription(html) {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const firstDot = text.indexOf('.');
  const cleaned = firstDot >= 0 ? text.slice(0, firstDot + 1) : text;
  return cleaned.length > 70 ? cleaned.slice(0, 67) + '…' : cleaned;
}

(async () => {
  if (!TOKEN) {
    console.error('ERRO: TOKEN ausente. Defina o secret SHOP_ADMIN_API_TOKEN no GitHub.');
    process.exit(1);
  }
  console.log(`Store: ${STORE} | API: ${API_VERSION} | Metafield: ${MF_NAMESPACE}.${MF_KEY}`);

  let cursor = null;
  let updated = 0, skipped = 0, total = 0;

  while (true) {
    const data = await shopifyGraphQL(LIST_PRODUCTS, { cursor });
    const edges = data.products.edges;
    for (const { node } of edges.map(e => e)) {
      total++;
      const friendly = firstLineFromDescription(node.description);
      if (!friendly) { skipped++; continue; }

      const existing = node.metafield?.value || null;
      if (existing === friendly) { skipped++; continue; }

      const result = await shopifyGraphQL(SET_METAFIELD, {
        ownerId: node.id,
        value: friendly
      });

      const errs = result.metafieldsSet?.userErrors || [];
      if (errs.length) {
        console.error('userErrors:', JSON.stringify(errs, null, 2), 'product:', node.id);
        // não para a execução; segue pro próximo
        continue;
      }
      updated++;
      console.log(`✔ Atualizado: ${node.title} → "${friendly}"`);
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}, Total scanned: ${total}`);
})().catch(err => {
  console.error('FALHA:', err.message || err);
  process.exit(1);
});
