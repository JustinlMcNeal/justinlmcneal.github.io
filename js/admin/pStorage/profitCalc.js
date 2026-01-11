// /js/admin/pStorage/profitCalc.js
// Profit projection calculations for Product Storage

/**
 * Calculate supplier shipping cost based on weight and quantity
 * Uses tiered carrier selection:
 *   - EUB for shipments ≤ 2000g (cheapest, but has weight limit)
 *   - HK-UPS for shipments > 2000g (reliable for heavier shipments)
 * 
 * EUB rates (up to 2kg):
 *   500g = 148 CNY, 1500g = 268 CNY
 *   Formula: 88 + (weight × 0.12) CNY
 * 
 * HK-UPS rates (any weight):
 *   500g = 335 CNY, 1500g = 375 CNY, 3000g = 450 CNY, 8000g = 715 CNY
 *   Formula: 297 + (weight × 0.0523) CNY
 * 
 * @param {number} weightG - Weight per unit in grams
 * @param {number} qty - Quantity of units
 * @returns {object} Shipping cost details including carrier used
 */
export function calculateSupplierShipping(weightG, qty = 30) {
  if (!weightG || weightG <= 0) return 0;
  
  const totalWeight = weightG * qty;
  const cnyToUsd = 0.1437;
  
  let totalCNY;
  
  if (totalWeight <= 2000) {
    // EUB: cheapest for light shipments
    totalCNY = 88 + (totalWeight * 0.12);
  } else {
    // HK-UPS: reliable for heavier shipments
    totalCNY = 297 + (totalWeight * 0.0523);
  }
  
  return totalCNY * cnyToUsd;
}

/**
 * Get detailed supplier shipping breakdown
 */
export function getSupplierShippingDetails(weightG, qty = 30) {
  if (!weightG || weightG <= 0) {
    return { carrier: null, totalCNY: 0, totalUSD: 0, perUnitUSD: 0 };
  }
  
  const totalWeight = weightG * qty;
  const cnyToUsd = 0.1437;
  
  let totalCNY;
  let carrier;
  
  if (totalWeight <= 2000) {
    carrier = 'EUB';
    totalCNY = 88 + (totalWeight * 0.12);
  } else {
    carrier = 'HK-UPS';
    totalCNY = 297 + (totalWeight * 0.0523);
  }
  
  const totalUSD = totalCNY * cnyToUsd;
  const perUnitUSD = totalUSD / qty;
  
  return { carrier, totalCNY, totalUSD, perUnitUSD, totalWeight };
}

/**
 * Calculate per-unit supplier shipping cost
 * @param {number} weightG - Weight per unit in grams
 * @param {number} qty - Quantity of units
 * @returns {number} Shipping cost per unit in USD
 */
export function calculateSupplierShippingPerUnit(weightG, qty = 30) {
  const totalShipping = calculateSupplierShipping(weightG, qty);
  return qty > 0 ? totalShipping / qty : 0;
}

/**
 * Calculate shipping to customer cost via Pirate Ship USPS Ground Advantage
 * Based on Oct 2025 Pirate Ship rates (national average, commercial pricing)
 * Using slightly conservative estimates to account for zone variation
 * 
 * @param {number} weightG - Weight in grams
 * @returns {number|string} Shipping cost or "Too Heavy" message
 */
export function calculateCustomerShipping(weightG) {
  if (!weightG || weightG <= 0) return 0;
  
  // Convert grams to ounces for easier rate lookup
  const oz = weightG / 28.35;
  const lbs = weightG / 453.6;
  
  // Pirate Ship USPS Ground Advantage Weight-Based rates (Oct 2025, national averages)
  // These are commercial pricing estimates - actual rates vary by zone
  if (oz <= 4) return 4.85;           // 1-4 oz
  if (oz <= 8) return 5.30;           // 5-8 oz
  if (oz <= 12) return 5.75;          // 9-12 oz
  if (oz <= 15.99) return 6.20;       // 13-15.99 oz (under 1 lb)
  
  // 1 lb and over - rates increase by weight
  if (lbs <= 1) return 6.50;          // 1 lb
  if (lbs <= 2) return 8.50;          // 2 lb
  if (lbs <= 3) return 9.75;          // 3 lb  
  if (lbs <= 4) return 10.50;         // 4 lb
  if (lbs <= 5) return 11.25;         // 5 lb
  if (lbs <= 10) return 14.00;        // 6-10 lb
  if (lbs <= 15) return 18.00;        // 11-15 lb
  if (lbs <= 20) return 22.00;        // 16-20 lb
  if (lbs <= 70) return 35.00;        // 21-70 lb (max for Ground Advantage)
  
  return "Too Heavy";
}

/**
 * Find optimal bulk quantity for best value
 * Analyzes different quantities to find the sweet spot
 * @param {number} unitCost - Cost per unit
 * @param {number} weightG - Weight per unit in grams
 * @returns {Object} Recommended quantities with analysis
 */
export function findOptimalBulkQty(unitCost, weightG) {
  if (!unitCost || unitCost <= 0 || !weightG || weightG <= 0) {
    return { recommended: 30, analysis: [] };
  }
  
  // Test quantities from 10 to 200 in increments
  const testQtys = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200];
  const analysis = [];
  
  for (const qty of testQtys) {
    const supplierShipTotal = calculateSupplierShipping(weightG, qty);
    const supplierShipPerUnit = supplierShipTotal / qty;
    const totalCostPerUnit = unitCost + supplierShipPerUnit;
    const totalInvestment = unitCost * qty + supplierShipTotal;
    
    analysis.push({
      qty,
      supplierShipTotal,
      supplierShipPerUnit,
      totalCostPerUnit,
      totalInvestment,
      // Value score: lower cost per unit is better, but consider investment size
      valueScore: (1 / totalCostPerUnit) * 1000,
    });
  }
  
  // Find best value (lowest cost per unit)
  const bestValue = analysis.reduce((best, curr) => 
    curr.totalCostPerUnit < best.totalCostPerUnit ? curr : best
  );
  
  // Find reasonable recommendation (good value without huge investment)
  // Sweet spot: cost per unit within 10% of best, but lower investment
  const threshold = bestValue.totalCostPerUnit * 1.10;
  const reasonable = analysis.find(a => 
    a.totalCostPerUnit <= threshold && a.totalInvestment <= 500
  ) || analysis.find(a => 
    a.totalCostPerUnit <= threshold && a.totalInvestment <= 1000
  ) || bestValue;
  
  return {
    recommended: reasonable.qty,
    bestValue: bestValue.qty,
    analysis: analysis.slice(0, 8), // Return first 8 for display
  };
}

/**
 * Calculate profit projections for a product
 * @param {Object} item - The product storage item
 * @returns {Object} Profit calculations and recommendations
 */
export function calculateProfitProjections(item) {
  const unitCost = Number(item.unit_cost) || 0;
  const supplierShipManual = Number(item.supplier_ship) || 0;
  const stccManual = Number(item.stcc) || 0; // Ship to customer cost (manual override)
  const targetPrice = Number(item.target_price) || 0;
  const bulkQty = Number(item.bulk_qty) || 30;
  const weightG = Number(item.weight_g) || 0;
  
  // Calculate shipping costs from formulas (or use manual overrides)
  const supplierShipDetails = getSupplierShippingDetails(weightG, bulkQty);
  const calculatedSupplierShipTotal = supplierShipDetails.totalUSD;
  const calculatedSupplierShipPerUnit = supplierShipDetails.perUnitUSD;
  const supplierCarrier = supplierShipDetails.carrier;
  
  const calculatedCustomerShip = calculateCustomerShipping(weightG);
  const customerShipCost = typeof calculatedCustomerShip === 'number' ? calculatedCustomerShip : 0;
  const isTooHeavy = calculatedCustomerShip === "Too Heavy";
  
  // Use manual override if provided, otherwise use calculated
  const supplierShipPerUnit = supplierShipManual > 0 ? supplierShipManual : calculatedSupplierShipPerUnit;
  const customerShip = stccManual > 0 ? stccManual : customerShipCost;
  
  // Cost scenarios
  // CPI with PAID shipping = customer pays for shipping, so we don't include it in our cost
  const cpiPaidShipping = unitCost + supplierShipPerUnit;
  
  // CPI with FREE shipping = we pay for shipping to customer
  const cpiFreeShipping = unitCost + supplierShipPerUnit + customerShip;
  
  // Legacy compatibility: totalCostPerUnit uses free shipping scenario
  const totalCostPerUnit = cpiFreeShipping;
  
  // Profit calculations for both scenarios
  const profitPaidShipping = targetPrice > 0 ? targetPrice - cpiPaidShipping : 0;
  const profitFreeShipping = targetPrice > 0 ? targetPrice - cpiFreeShipping : 0;
  
  const marginPaidShipping = targetPrice > 0 ? (profitPaidShipping / targetPrice) * 100 : 0;
  const marginFreeShipping = targetPrice > 0 ? (profitFreeShipping / targetPrice) * 100 : 0;
  
  // Use free shipping scenario for main display (more conservative)
  const profitPerUnit = profitFreeShipping;
  const profitMargin = marginFreeShipping;
  
  // Recommended prices at different margin targets (based on free shipping cost)
  const recommendedPrices = {
    margin30: cpiFreeShipping > 0 ? cpiFreeShipping / 0.70 : 0,
    margin40: cpiFreeShipping > 0 ? cpiFreeShipping / 0.60 : 0,
    margin50: cpiFreeShipping > 0 ? cpiFreeShipping / 0.50 : 0,
    margin60: cpiFreeShipping > 0 ? cpiFreeShipping / 0.40 : 0,
  };
  
  // Recommended prices for paid shipping scenario
  const recommendedPricesPaidShip = {
    margin30: cpiPaidShipping > 0 ? cpiPaidShipping / 0.70 : 0,
    margin40: cpiPaidShipping > 0 ? cpiPaidShipping / 0.60 : 0,
    margin50: cpiPaidShipping > 0 ? cpiPaidShipping / 0.50 : 0,
    margin60: cpiPaidShipping > 0 ? cpiPaidShipping / 0.40 : 0,
  };
  
  // Bulk order projections (using free shipping as conservative estimate)
  const bulkInvestment = (unitCost * bulkQty) + calculatedSupplierShipTotal;
  const bulkRevenue = targetPrice * bulkQty;
  const bulkProfitPaid = profitPaidShipping * bulkQty;
  const bulkProfitFree = profitFreeShipping * bulkQty;
  
  // Break-even analysis
  const breakEvenPaidShip = profitPaidShipping > 0 ? Math.ceil(bulkInvestment / profitPaidShipping) : 0;
  const breakEvenFreeShip = profitFreeShipping > 0 ? Math.ceil(bulkInvestment / profitFreeShipping) : 0;
  
  // Find optimal bulk quantity
  const optimalQty = findOptimalBulkQty(unitCost, weightG);
  
  // Profit health indicator (based on free shipping - more conservative)
  let profitHealth = "unknown";
  let healthColor = "gray";
  let healthEmoji = "❓";
  
  if (targetPrice > 0 && cpiFreeShipping > 0) {
    if (profitMargin >= 50) {
      profitHealth = "excellent";
      healthColor = "green";
      healthEmoji = "🔥";
    } else if (profitMargin >= 40) {
      profitHealth = "good";
      healthColor = "emerald";
      healthEmoji = "✅";
    } else if (profitMargin >= 30) {
      profitHealth = "okay";
      healthColor = "yellow";
      healthEmoji = "👍";
    } else if (profitMargin >= 15) {
      profitHealth = "low";
      healthColor = "orange";
      healthEmoji = "⚠️";
    } else if (profitMargin > 0) {
      profitHealth = "poor";
      healthColor = "red";
      healthEmoji = "❌";
    } else {
      profitHealth = "loss";
      healthColor = "red";
      healthEmoji = "💸";
    }
  }
  
  return {
    // Base costs
    unitCost,
    weightG,
    bulkQty,
    
    // Shipping costs (calculated)
    calculatedSupplierShipTotal,
    calculatedSupplierShipPerUnit,
    calculatedCustomerShip: customerShipCost,
    supplierCarrier,  // EUB or HK-UPS
    isTooHeavy,
    
    // Shipping costs (used - may be manual override)
    supplierShipPerUnit,
    customerShip,
    
    // Cost per item scenarios
    cpiPaidShipping,      // Customer pays shipping
    cpiFreeShipping,      // We pay shipping (free to customer)
    totalCostPerUnit,     // Legacy (same as free shipping)
    
    // Profit scenarios
    targetPrice,
    profitPaidShipping,
    profitFreeShipping,
    marginPaidShipping,
    marginFreeShipping,
    profitPerUnit,        // Legacy (free shipping)
    profitMargin,         // Legacy (free shipping)
    
    // Health indicators
    profitHealth,
    healthColor,
    healthEmoji,
    
    // Recommendations
    recommendedPrices,           // For free shipping
    recommendedPricesPaidShip,   // For paid shipping
    optimalQty,
    
    // Bulk projections
    bulkInvestment,
    bulkRevenue,
    bulkProfitPaid,
    bulkProfitFree,
    breakEvenPaidShip,
    breakEvenFreeShip,
    
    // Legacy compatibility
    bulkTotalCost: bulkInvestment,
    bulkProfit: bulkProfitFree,
    breakEvenUnits: breakEvenFreeShip,
    supplierShip: supplierShipPerUnit,
    stcc: customerShip,
    
    // Flags
    hasEnoughData: unitCost > 0 || weightG > 0,
    hasWeight: weightG > 0,
    isProfitable: profitFreeShipping > 0,
  };
}

/**
 * Format profit projections as HTML for display
 */
export function renderProfitCard(projections) {
  if (!projections.hasEnoughData) {
    return `
      <div class="bg-gray-50 rounded-lg p-4 text-center">
        <div class="text-2xl mb-2">📊</div>
        <div class="text-sm text-gray-600">Add unit cost or weight to see profit projections</div>
      </div>
    `;
  }
  
  const formatMoney = (n) => `$${Number(n || 0).toFixed(2)}`;
  const formatPercent = (n) => `${Number(n || 0).toFixed(1)}%`;
  
  const marginColorClass = {
    green: "text-green-600 bg-green-50",
    emerald: "text-emerald-600 bg-emerald-50",
    yellow: "text-yellow-600 bg-yellow-50",
    orange: "text-orange-600 bg-orange-50",
    red: "text-red-600 bg-red-50",
    gray: "text-gray-600 bg-gray-50",
  }[projections.healthColor] || "text-gray-600 bg-gray-50";
  
  return `
    <div class="space-y-4">
      <!-- Shipping Cost Breakdown -->
      ${projections.hasWeight ? `
      <div class="bg-amber-50 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="text-xs font-bold uppercase tracking-wider text-amber-500">🚚 Shipping Cost Calculator</div>
          ${projections.supplierCarrier ? `
          <span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
            via ${projections.supplierCarrier}
          </span>
          ` : ''}
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="bg-white/60 rounded-lg p-3">
            <div class="text-xs text-amber-600 mb-1">Supplier → You (${projections.bulkQty} units)</div>
            <div class="font-bold text-gray-800">${formatMoney(projections.calculatedSupplierShipTotal)}</div>
            <div class="text-xs text-gray-500 mt-0.5">${formatMoney(projections.calculatedSupplierShipPerUnit)}/unit</div>
          </div>
          <div class="bg-white/60 rounded-lg p-3">
            <div class="text-xs text-amber-600 mb-1">You → Customer (USPS)</div>
            <div class="font-bold ${projections.isTooHeavy ? 'text-red-600' : 'text-gray-800'}">
              ${projections.isTooHeavy ? '⚠️ Too Heavy' : formatMoney(projections.calculatedCustomerShip)}
            </div>
            <div class="text-xs text-gray-500 mt-0.5">${projections.weightG}g per unit</div>
          </div>
        </div>
        <div class="mt-2 text-xs text-amber-600">
          💡 ${projections.supplierCarrier === 'EUB' ? 'EUB is cheapest for orders ≤2kg' : 'HK-UPS used for heavier orders (>2kg)'}
        </div>
      </div>
      ` : ''}
      
      <!-- Cost Per Item Comparison -->
      <div class="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="text-xs font-bold uppercase tracking-wider text-gray-400">💰 Cost Per Item (CPI)</div>
          <span class="text-lg">${projections.healthEmoji}</span>
        </div>
        
        <div class="grid grid-cols-2 gap-3 text-sm">
          <!-- Paid Shipping (Customer Pays) -->
          <div class="bg-green-50 rounded-lg p-3 border border-green-100">
            <div class="flex items-center gap-1 mb-2">
              <span class="text-green-600 font-semibold text-xs">💵 Paid Shipping</span>
            </div>
            <div class="space-y-1">
              <div class="flex justify-between">
                <span class="text-gray-500">CPI:</span>
                <span class="font-bold text-gray-800">${formatMoney(projections.cpiPaidShipping)}</span>
              </div>
              ${projections.targetPrice > 0 ? `
              <div class="flex justify-between">
                <span class="text-gray-500">Profit:</span>
                <span class="font-bold ${projections.profitPaidShipping > 0 ? 'text-green-600' : 'text-red-600'}">
                  ${projections.profitPaidShipping > 0 ? '+' : ''}${formatMoney(projections.profitPaidShipping)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Margin:</span>
                <span class="font-semibold text-green-600">${formatPercent(projections.marginPaidShipping)}</span>
              </div>
              ` : ''}
            </div>
          </div>
          
          <!-- Free Shipping (You Pay) -->
          <div class="bg-orange-50 rounded-lg p-3 border border-orange-100">
            <div class="flex items-center gap-1 mb-2">
              <span class="text-orange-600 font-semibold text-xs">🆓 Free Shipping</span>
            </div>
            <div class="space-y-1">
              <div class="flex justify-between">
                <span class="text-gray-500">CPI:</span>
                <span class="font-bold text-gray-800">${formatMoney(projections.cpiFreeShipping)}</span>
              </div>
              ${projections.targetPrice > 0 ? `
              <div class="flex justify-between">
                <span class="text-gray-500">Profit:</span>
                <span class="font-bold ${projections.profitFreeShipping > 0 ? 'text-green-600' : 'text-red-600'}">
                  ${projections.profitFreeShipping > 0 ? '+' : ''}${formatMoney(projections.profitFreeShipping)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Margin:</span>
                <span class="font-semibold ${marginColorClass} px-1.5 rounded">${formatPercent(projections.marginFreeShipping)}</span>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
      
      <!-- Recommended Prices -->
      <div class="bg-blue-50 rounded-xl p-4">
        <div class="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3">💡 Recommended Prices (Free Shipping)</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
            <span class="text-gray-600">30% margin</span>
            <span class="font-bold text-gray-800">${formatMoney(projections.recommendedPrices.margin30)}</span>
          </div>
          <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
            <span class="text-gray-600">40% margin</span>
            <span class="font-bold text-gray-800">${formatMoney(projections.recommendedPrices.margin40)}</span>
          </div>
          <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
            <span class="text-gray-600">50% margin</span>
            <span class="font-bold text-green-600">${formatMoney(projections.recommendedPrices.margin50)}</span>
          </div>
          <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
            <span class="text-gray-600">60% margin</span>
            <span class="font-bold text-emerald-600">${formatMoney(projections.recommendedPrices.margin60)}</span>
          </div>
        </div>
        
        <!-- Toggle for Paid Shipping prices -->
        <details class="mt-3">
          <summary class="text-xs text-blue-600 cursor-pointer hover:underline">View Paid Shipping prices</summary>
          <div class="grid grid-cols-2 gap-2 text-sm mt-2">
            <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
              <span class="text-gray-600">30%</span>
              <span class="font-bold text-gray-800">${formatMoney(projections.recommendedPricesPaidShip.margin30)}</span>
            </div>
            <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
              <span class="text-gray-600">40%</span>
              <span class="font-bold text-gray-800">${formatMoney(projections.recommendedPricesPaidShip.margin40)}</span>
            </div>
            <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
              <span class="text-gray-600">50%</span>
              <span class="font-bold text-green-600">${formatMoney(projections.recommendedPricesPaidShip.margin50)}</span>
            </div>
            <div class="flex justify-between items-center bg-white/50 rounded-lg px-3 py-2">
              <span class="text-gray-600">60%</span>
              <span class="font-bold text-emerald-600">${formatMoney(projections.recommendedPricesPaidShip.margin60)}</span>
            </div>
          </div>
        </details>
      </div>
      
      <!-- Bulk Order Projections -->
      <div class="bg-purple-50 rounded-xl p-4">
        <div class="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3">📦 Bulk Order (${projections.bulkQty} units)</div>
        <div class="grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <div class="text-xs text-purple-400">Investment</div>
            <div class="font-bold text-gray-800">${formatMoney(projections.bulkInvestment)}</div>
          </div>
          <div>
            <div class="text-xs text-purple-400">Revenue</div>
            <div class="font-bold text-gray-800">${formatMoney(projections.bulkRevenue)}</div>
          </div>
          <div>
            <div class="text-xs text-purple-400">Profit (Free)</div>
            <div class="font-bold ${projections.bulkProfitFree > 0 ? 'text-green-600' : 'text-red-600'}">
              ${projections.bulkProfitFree > 0 ? '+' : ''}${formatMoney(projections.bulkProfitFree)}
            </div>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div class="bg-white/50 rounded-lg px-3 py-2 text-center">
            <span class="text-purple-500">Break-even (Paid): </span>
            <span class="font-bold text-gray-800">${projections.breakEvenPaidShip} units</span>
          </div>
          <div class="bg-white/50 rounded-lg px-3 py-2 text-center">
            <span class="text-purple-500">Break-even (Free): </span>
            <span class="font-bold text-gray-800">${projections.breakEvenFreeShip} units</span>
          </div>
        </div>
      </div>
      
      <!-- Optimal Quantity Recommendation -->
      ${projections.hasWeight && projections.optimalQty ? `
      <div class="bg-teal-50 rounded-xl p-4">
        <div class="text-xs font-bold uppercase tracking-wider text-teal-500 mb-3">🎯 Recommended Order Quantity</div>
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-2xl font-black text-teal-700">${projections.optimalQty.recommended} units</div>
            <div class="text-xs text-teal-600">Best value for reasonable investment</div>
          </div>
          ${projections.optimalQty.bestValue !== projections.optimalQty.recommended ? `
          <div class="text-right">
            <div class="text-sm font-bold text-gray-600">${projections.optimalQty.bestValue} units</div>
            <div class="text-xs text-gray-500">Absolute best $/unit</div>
          </div>
          ` : ''}
        </div>
        
        <details class="mt-2">
          <summary class="text-xs text-teal-600 cursor-pointer hover:underline">View quantity analysis</summary>
          <div class="mt-2 overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-teal-600">
                  <th class="py-1">Qty</th>
                  <th class="py-1">Ship/unit</th>
                  <th class="py-1">CPI</th>
                  <th class="py-1">Investment</th>
                </tr>
              </thead>
              <tbody class="text-gray-700">
                ${projections.optimalQty.analysis.map(a => `
                  <tr class="${a.qty === projections.optimalQty.recommended ? 'bg-teal-100 font-semibold' : ''}">
                    <td class="py-1">${a.qty}</td>
                    <td class="py-1">${formatMoney(a.supplierShipPerUnit)}</td>
                    <td class="py-1">${formatMoney(a.totalCostPerUnit)}</td>
                    <td class="py-1">${formatMoney(a.totalInvestment)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      ` : ''}
    </div>
  `;
}

/**
 * Get a compact profit indicator for table/card views
 */
export function getProfitIndicator(item) {
  const projections = calculateProfitProjections(item);
  
  if (!projections.hasEnoughData) {
    return { html: '', hasData: false };
  }
  
  const formatPercent = (n) => `${Number(n || 0).toFixed(0)}%`;
  
  const colorClass = {
    green: "bg-green-100 text-green-700",
    emerald: "bg-emerald-100 text-emerald-700",
    yellow: "bg-yellow-100 text-yellow-700",
    orange: "bg-orange-100 text-orange-700",
    red: "bg-red-100 text-red-700",
    gray: "bg-gray-100 text-gray-700",
  }[projections.healthColor] || "bg-gray-100 text-gray-700";
  
  return {
    html: `
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${colorClass}">
        ${projections.healthEmoji} ${formatPercent(projections.profitMargin)}
      </span>
    `,
    hasData: true,
    margin: projections.profitMargin,
    profit: projections.profitPerUnit,
    health: projections.profitHealth,
  };
}
