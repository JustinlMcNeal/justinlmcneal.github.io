export function createState() {
  return {
    items: [],
    view: [],
    q: "",

    setItems(rows) {
      this.items = Array.isArray(rows) ? rows : [];
      this.recompute();
    },

    setQuery(q) {
      this.q = (q || "").trim().toLowerCase();
      this.recompute();
    },

    recompute() {
      const q = this.q;
      let out = [...this.items];

      if (q) {
        out = out.filter((x) => {
          const name = (x.name || "").toLowerCase();
          const pid = (x.product_id || "").toLowerCase();
          const url = (x.url || "").toLowerCase();
          const tags = Array.isArray(x.tags) ? x.tags.join(",").toLowerCase() : "";
          return name.includes(q) || pid.includes(q) || url.includes(q) || tags.includes(q);
        });
      }

      // default sort: updated desc
      out.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      this.view = out;
    },

    upsertLocal(row) {
      const idx = this.items.findIndex((x) => x.id === row.id);
      if (idx >= 0) this.items[idx] = row;
      else this.items.unshift(row);
      this.recompute();
    },

    removeLocal(id) {
      this.items = this.items.filter((x) => x.id !== id);
      this.recompute();
    },

    getById(id) {
      return this.items.find((x) => x.id === id) || null;
    }
  };
}
