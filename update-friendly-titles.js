import fetch from "node-fetch";

// ✅ seu domínio fixo aqui:
const SHOP = "xz5315-nz.myshopify.com";

// 🔒 o token vem dos “secrets” do GitHub (SHOP_ADMIN_API_TOKEN)
const TOKEN = process.env.TOKEN || process.env.SHOP_ADMIN_API_TOKEN;

const API_VERSION = "2024-10";
const NAMESPACE = "custom";
const KEY = "friendly_title_first_line";
// Opcional: limite por data se quiser processar só produtos recentes
const SINCE = process.env.SINCE || ""; // ex: "2025-01-01T00:00:00Z"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstLineFromHTML(html = "") {
  let body = html.replace(/<br\s*\/?>/gi, "\n").replace(/\r/g, "");
  let first = "";
  const pClose = body.toLowerCase().indexOf("</p>");
  if (pClose !== -1) {
    const afterPOpen = body.split(/<p[^>]*>/i)[1] || "";
    first = afterPOpen.split(/<\/p>/i)[0] || "";
  } else {
    first = body.replace(/<[^>]*>/g, "").split("\n")[0] || "";
  }
  first = first.replace(/<[^>]*>/g, "").trim();
  if (!first) return "";
  if (first.length > 200) return first.slice(0, 197).trim() + "…";
  return first;
}

async function gql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function* productsIterator() {
  let hasNextPage = true;
  let cursor = null;
  const sinceFilter = SINCE ? `, query: "updated_at:>=${SINCE}"` : "";

  while (hasNextPage) {
    const data = await gql(
      `
      query GetProducts($cursor: String) {
        products(first: 100, after: $cursor${sinceFilter}) {
          pageInfo { hasNextPage }
          edges {
            cursor
            node {
              id
              title
              bodyHtml
              metafields(first: 1, namespace: "${NAMESPACE}", keys: ["${KEY}"]) {
                edges { node { key value } }
              }
            }
          }
        }
      }`,
      { cursor }
    );

    for (const edge of data.products.edges) {
      yield edge.node;
      cursor = edge.cursor;
    }
    hasNextPage = data.products.pageInfo.hasNextPage;
    await sleep(400); // respeita limites
  }
}

async function updateMetafield(productId, value) {
  const input = {
    id: productId,
    metafields: [
      {
        namespace: NAMESPACE,
        key: KEY,
        type: "single_line_text_field",
        value,
      },
    ],
  };

  const data = await gql(
    `
    mutation UpdateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }`,
    { input }
  );
  const errs = data.productUpdate.userErrors;
  if (errs?.length) console.error("Update error:", errs);
}

async function run() {
  let updated = 0,
    skipped = 0;

  for await (const p of productsIterator()) {
    const current = p.metafields.edges?.[0]?.node?.value || "";
    const friendly = firstLineFromHTML(p.bodyHtml || "") || p.title;

    if (current !== friendly) {
      await updateMetafield(p.id, friendly);
      updated++;
    } else {
      skipped++;
    }
    await sleep(250);
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
