// In-memory RPC double only; real SQL/security is covered by backend/tests/pricing-rls.mjs.
const products = [];
export function pricingMock(path, p, rows, company, send) {
  if (p.p_empresa !== company) return send(403, { code: "42501" });
  const fail = (message) => send(409, { code: "P0001", message });
  const supplies = rows.insumos.map((s) => {
    const prices = [
      ...rows.historico_precos,
      ...rows.insumos_precos_registrados,
    ]
      .filter(
        (h) => h.insumo_id === s.id && h.unidade_medida === s.unidade_medida,
      )
      .sort((a, b) => b.data_compra.localeCompare(a.data_compra));
    return {
      id: s.id,
      name: s.nome,
      unit: s.unidade_medida,
      active: s.ativo,
      price: prices[0]?.valor_unitario ?? null,
      date: prices[0]?.data_compra ?? null,
    };
  });
  if (path.endsWith("dados_precificacao"))
    return send(200, { tax: 0, products, supplies });
  const d = p.p_dados;
  let inputCost = 0;
  const lines = [];
  for (const i of d.ingredients) {
    const s = supplies.find((s) => s.id === i.supplyId);
    if (!s?.active || s.price === null)
      return fail("Há insumo sem preço de compra na unidade cadastrada.");
    inputCost += s.price * i.quantity;
    lines.push({
      name: s.name,
      unit: s.unit,
      quantity: i.quantity,
      price: s.price,
      cost: s.price * i.quantity,
    });
  }
  const cost = Math.round((d.baseCost + inputCost) * 100) / 100;
  if (cost <= 0)
    return fail(
      "Impossível calcular: vincule insumos ou defina um custo base para este produto.",
    );
  const suggestedPrice = Math.round(cost * (1 + d.markup / 100) * 100) / 100,
    profit = suggestedPrice - cost;
  const quote = {
    cost,
    inputCost,
    tax: 0,
    taxCost: 0,
    suggestedPrice,
    profit,
    margin: Math.round((profit / suggestedPrice) * 10000) / 100,
    monthlyRevenue: suggestedPrice * d.monthlyUnits,
    revenueDifference:
      d.currentPrice === null
        ? null
        : (suggestedPrice - d.currentPrice) * d.monthlyUnits,
    lines,
  };
  if (path.endsWith("calcular_precificacao")) return send(200, quote);
  let product = products.find((x) => x.id === p.p_id);
  if (product && product.version !== p.p_versao)
    return fail("O produto mudou. Atualize os dados antes de salvar.");
  if (
    products.some(
      (x) => x.id !== p.p_id && x.name.toLowerCase() === d.name.toLowerCase(),
    )
  )
    return fail("Já existe um produto com esse nome.");
  if (!product) {
    product = { id: p.p_id };
    products.push(product);
  }
  Object.assign(product, d, {
    version: crypto.randomUUID(),
    active: true,
    referenceCost: quote.cost,
  });
  return send(200, { id: product.id, version: product.version, quote });
}
