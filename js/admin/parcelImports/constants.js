/** Parcel Imports — shared constants (Phase 1B). */

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".xls", ".xlsx"];
export const ACCEPTED_MIME_HINTS = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/plain",
];

export const SOURCE_FORMAT = {
  BAESTAO_HTML_XLS: "baestao_html_xls",
  UNKNOWN: "unknown",
};

/** Required internal keys on item table header map (at least name + qty). */
export const REQUIRED_ITEM_COLUMNS = ["sourceItemName", "quantity"];

/**
 * Item table headers — canonical English export (waybill 227461) + Chinese fallbacks.
 * "Total" → rowTotalCny (domestic/extra column; not assumed to be seller freight).
 */
export const ITEM_HEADER_ALIASES = {
  exportRowNo: ["no.", "no", "#", "序号", "行号"],
  sourceItemName: [
    "item name",
    "itemname",
    "商品名称",
    "货品名称",
    "商品名",
    "产品名称",
    "product name",
    "title",
  ],
  baestaoOrderId: ["order id", "orderid", "订单号", "订单编号", "订单"],
  sellerName: [
    "taobao seller",
    "taobaoseller",
    "seller",
    "卖家",
    "店铺",
    "店铺名称",
  ],
  unitPriceCny: ["price", "unit price", "unitprice", "单价", "价格", "商品单价"],
  quantity: ["qty", "quantity", "数量", "件数", "购买数量"],
  itemWeightGrams: [
    "weight(g)",
    "weightg",
    "weight",
    "重量",
    "商品重量",
    "重量(克)",
  ],
  removePackage: ["remove package", "removepackage", "去包装", "包装"],
  rowTotalCny: ["total", "row total", "line total", "小计", "合计"],
  sellerFreightCny: [
    "seller freight",
    "domestic freight",
    "卖家运费",
    "国内运费",
    "freight fee",
  ],
  lineItemSubtotalCny: ["subtotal", "amount", "商品金额"],
};

/** Footer / summary labels inside or below the item table. */
export const PARCEL_FOOTER_ALIASES = {
  parcelId: ["parcel id", "parcel no", "包裹号", "包裹编号", "运单号"],
  totalItems: ["item qty", "item quantity", "total items", "总件数", "商品件数"],
  parcelWeightGrams: ["parcel weight", "包裹重量", "总重量"],
  chargedWeightGrams: ["charged weight", "计费重量", "收费重量", "结算重量"],
  totalItemFeeCny: ["total item fee", "item total", "商品总额", "货品总额"],
  shipmentFeeCny: ["shipment fee", "international freight", "国际运费", "快递费"],
  insurance: ["with insurance", "insurance", "保险", "保险费"],
  serviceFeeCny: ["service fee", "服务费", "手续费"],
};

/** Narrow 2-column summary tables (legacy). */
export const PARCEL_LABEL_ALIASES = {
  parcelId: ["parcel id", "包裹编号"],
  parcelWeightGrams: ["parcel weight", "包裹重量"],
  chargedWeightGrams: ["charged weight", "计费重量"],
  totalItemFeeCny: ["total item fee", "商品总额"],
  shipmentFeeCny: ["shipment fee", "国际运费"],
  insurance: ["with insurance", "保险"],
  totalItems: ["item qty", "总件数"],
};

export const UPLOAD_STATUS = {
  IDLE: "idle",
  PARSING: "parsing",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
};

export const MAX_UPLOAD_ISSUES_SHOWN = 5;

export const ROW_TYPE_DEFAULT = "Business Inventory";

export const ROW_TYPE = {
  BUSINESS: "Business Inventory",
  PERSONAL: "Personal / Excluded",
  SUPPLIES: "Supplies",
  UNKNOWN: "Unknown",
};

export const MAPPING_STATUS = {
  NEEDS_MAPPING: "Needs Mapping",
  MATCHED: "Matched",
  VARIANT_UNCERTAIN: "Variant Uncertain",
  PERSONAL_EXCLUDED: "Personal / Excluded",
  PARSER_WARNING: "Parser Warning",
};

export const PLACEHOLDER_PRODUCT = "Select product";
export const PLACEHOLDER_VARIANT = "—";

export const MAPPING_PRODUCT_OPTIONS = [
  PLACEHOLDER_PRODUCT,
  "Cosmic Bear Charm Keychain",
  "8-Ball Dice Charm Keychain",
  "Plush Mini Bag Charm",
  "Mini Pouch Charm",
  "Holographic Sticker Pack",
  "Ribbed Knit Beanie",
];

export const MAPPING_VARIANT_OPTIONS = [
  PLACEHOLDER_VARIANT,
  "Unknown",
  "Black",
  "Pink",
  "Blue",
  "Blue / Purple",
  "Small Box",
  "Large Box",
];

export const MAPPING_TYPE_OPTIONS = [
  ROW_TYPE.BUSINESS,
  ROW_TYPE.PERSONAL,
  ROW_TYPE.SUPPLIES,
  ROW_TYPE.UNKNOWN,
];

export const TRUNCATE_ITEM_NAME = 18;
export const TRUNCATE_SELLER = 12;
