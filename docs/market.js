/* Manual source values only; conversions are supplied by the local server. */
(function (root) {
  "use strict";
  const keyFor = (q) =>
    "market_" + q.currency + "_" + encodeURIComponent(q.name);
  const localDay = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const quoteDayFor = (state) => state?.market_quote_date || localDay();
  const displayedQuotes = (state) => (state.market_quotes || []).filter(
    (q) => q.quote_date === quoteDayFor(state),
  );
  function chart(state, group) {
    const manual = displayedQuotes(state),
      keys = [],
      labels = {},
      dates = {},
      rows = new Map(
        state.rows.map((r) => [r.month, { ...r, [group]: { ...r[group] } }]),
      );
    for (const q of manual) {
      const key = keyFor(q),
        month = q.month || "现货";
      if (!keys.includes(key)) keys.push(key);
      labels[key] = q.name + (q.currency === "CNY" ? "（人民币）" : "（美元）");
      if (!rows.has(month)) rows.set(month, { month, [group]: {} });
      rows.get(month)[group][key] = q[group];
      if (!dates[key]) dates[key] = {};
      dates[key][month] = q.quote_date || "";
    }
    return {
      rows: [...rows.values()].sort((a, b) =>
        a.month === "现货"
          ? -1
          : b.month === "现货"
            ? 1
            : a.month.localeCompare(b.month),
      ),
      keys,
      labels,
      dates,
    };
  }
  function skipGap(key, month) {
    return (
      key.startsWith("market_") || (key === "RU" && /-(02|12)$/.test(month))
    );
  }
  function seriesStyle(key, rows, group, index) {
    const symbols = [
      "square",
      "triangle",
      "diamond",
      "cross",
      "star",
      "circle",
    ];
    if (!key.startsWith("market_")) return { line: true, symbol: "circle" };
    const months = rows
      .filter((r) => Number.isFinite(r[group]?.[key]))
      .map((r) => r.month);
    const serial = (m) =>
      /^20\d\d-\d\d$/.test(m)
        ? Number(m.slice(0, 4)) * 12 + Number(m.slice(5))
        : null;
    return {
      symbol: symbols[index % symbols.length],
      line:
        months.length > 1 &&
        months.every(
          (m, i) =>
            serial(m) !== null &&
            (!i || serial(m) === serial(months[i - 1]) + 1),
        ),
    };
  }
  function parseQuotes(text, anchor, currency = "CNY") {
    const quotes = [],
      errors = [],
      notes = [],
      seen = new Set();
    if (typeof text !== "string" || !text.trim() || text.length > 10000)
      return { quotes, errors: ["请输入1–10000字报价文本"], notes, date: "" };
    const datePattern =
      /^(20\d{2})\s*[年\/.-]\s*(\d{1,2})\s*[月\/.-]\s*(\d{1,2})\s*日?$/;
    let reportDate = "";
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(),
        match = line.match(datePattern);
      if (!match) {
        lines.push(raw);
        continue;
      }
      const year = Number(match[1]),
        month = Number(match[2]),
        day = Number(match[3]),
        d = new Date(Date.UTC(year, month - 1, day));
      if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day
      ) {
        errors.push("报价日期无效：" + line);
        continue;
      }
      const value = [
        match[1],
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0"),
      ].join("-");
      if (reportDate && reportDate !== value)
        errors.push("同一段文本包含多个报价日期，请分开添加");
      else reportDate = value;
    }
    const effectiveAnchor = reportDate ? reportDate.slice(0, 7) : anchor;
    if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(effectiveAnchor || ""))
      return {
        quotes,
        errors: [...errors, "请先选择有效月份起点"],
        notes,
        date: reportDate,
      };
    const [year, start] = effectiveAnchor.split("-").map(Number);
    let dollarProduct = "";
    for (const source of lines.join("\n").split(/[\n，,；;]/)) {
      let line = source.trim().replace(/[。.!！]+$/, "");
      if (!line) continue;
      if (/^现货成交\s*[:：]/.test(line)) {
        currency = "CNY";
        dollarProduct = "";
        const content = line.replace(/^现货成交\s*[:：]\s*/, "");
        if (!/\d/.test(content)) {
          notes.push(line);
          continue;
        }
        line = content;
      }
      if (!/\d/.test(line) && /轮换|工厂|补货|五点半|买涨|买跌/.test(line)) {
        notes.push(line);
        continue;
      }
      let explicitCNY = false;
      if (/^(?:市场\s*)?(?:美元|美金)/.test(line)) {
        currency = "USD";
        dollarProduct = "";
        line = line.replace(
          /^(?:市场\s*)?(?:美元|美金)(?:成交|报价|价格)?\s*[:：]?\s*/,
          "",
        );
      } else if (/^(?:市场\s*)?(?:人民币|人混)/.test(line)) {
        currency = "CNY";
        explicitCNY = true;
        dollarProduct = "";
        line = line.replace(
          /^(?:市场\s*)?(?:人民币(?:市场)?|人混)(?:报价|成交)?\s*[:：]?\s*/,
          "",
        );
      }
      if (!line.trim()) continue;
      line = line.replace(/[（(][^）)]*[）)]/g, "").trim();
      const match =
        line.match(/(?:(20\d{2})[年/-])?(\d{1,2})月/) ||
        line.match(/(20\d{2})-(\d{2})(?=\s|$)/);
      let month = "",
        name = "",
        tail = line,
        kind = currency;
      if (match) {
        const m = Number(match[2]);
        if (m < 1 || m > 12) {
          errors.push("月份无效：" + source);
          continue;
        }
        month =
          (match[1] ? Number(match[1]) : year + (m < start ? 1 : 0)) +
          "-" +
          String(m).padStart(2, "0");
        name = line.slice(0, match.index).trim();
        tail = line.slice(match.index + match[0].length).trim();
      }
      const value = tail.match(
        /^([^\d]*?)(\d+(?:\.\d+)?)(?:\s*[-—~～至]\s*(\d+(?:\.\d+)?))?\s*([^\d]*)$/,
      );
      if (!value) {
        errors.push("无法识别：" + source);
        continue;
      }
      if (/[-+]$/.test(value[1].trim())) {
        errors.push("价格不能为负数：" + source);
        continue;
      }
      if (!name) name = value[1].trim();
      name = name
        .replace(/(?:报价|成交|价格|约)\s*$/, "")
        .replace(/^[·\s]+/, "")
        .trim();
      let qualifier = value[4]
        .replace(/\s*(?:左右|应该|美元\/吨|元\/吨|美元|美金|元|约)\s*/g, "")
        .trim();
      if (qualifier && !/^(近港|库内|库内买盘|买盘|卖盘)$/.test(qualifier)) {
        errors.push("价格备注无法识别：" + source);
        continue;
      }
      const spot = /^(挤出|颗粒)$/.test(name) && !month;
      if (spot) {
        kind = "CNY";
        currency = "CNY";
        dollarProduct = "";
        name = "人混·" + name;
      } else if (!explicitCNY && name && !/^(人混|人民币)$/.test(name))
        kind = "USD";
      const low = Number(value[2]),
        high = value[3] ? Number(value[3]) : low;
      if (
        low <= 0 ||
        high > 1e9 ||
        low > high ||
        (kind === "CNY" && !month && !spot)
      ) {
        errors.push("价格或月份无效：" + source);
        continue;
      }
      if (kind === "CNY" && !spot) name = "人混";
      if (kind === "USD") {
        if (/^(库内买盘|库内|近港|买盘|卖盘)$/.test(name)) {
          qualifier = name;
          name = dollarProduct;
        }
        if (!name) name = dollarProduct;
        if (!name) {
          errors.push("美元报价缺少品种名：" + source);
          continue;
        }
        dollarProduct = name;
        if (qualifier) name += "·" + qualifier;
      }
      const id = [kind, name, month].join("|");
      if (seen.has(id)) {
        errors.push("重复报价：" + source);
        continue;
      }
      seen.add(id);
      quotes.push({
        name,
        currency: kind,
        month,
        price: (low + high) / 2,
        ...(reportDate ? { quote_date: reportDate } : {}),
      });
    }
    if (quotes.length > 40) errors.push("每次最多解析40条报价");
    return { quotes, errors, notes, date: reportDate };
  }
  function attachHover({ box, svg, rows, keys, group, names, colors, dates = {},
    width, height, left, right, top, bottom }) {
    const doc = box.ownerDocument,
      tip = doc.createElement("div"),
      guide = doc.createElementNS("http://www.w3.org/2000/svg", "line"),
      unit = group === "usd" ? "美元/吨" : "元/吨",
      plotWidth = width - left - right;
    tip.className = "chart-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    for (const [key, value] of Object.entries({ y1: top, y2: height - bottom,
      stroke: "#94a3b8", "stroke-dasharray": "4 4", "pointer-events": "none",
      visibility: "hidden" })) guide.setAttribute(key, value);
    svg.append(guide);
    box.append(tip);
    let selected = -1;
    const hide = () => {
      tip.hidden = true;
      guide.setAttribute("visibility", "hidden");
      box.chartHoverPosition = null;
    };
    const show = (index, px, py) => {
      if (!rows.length) return hide();
      selected = index;
      const row = rows[index], title = doc.createElement("strong");
      title.textContent = `${row.month} · ${unit}`;
      tip.replaceChildren(title);
      for (const key of keys) {
        const value = row[group]?.[key];
        if (!Number.isFinite(value)) continue;
        const line = doc.createElement("div");
        line.style.color = colors[key] || "#334155";
        line.textContent = `${names[key] || key}：` + (Number.isFinite(value)
          ? value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "暂无报价");
        if (Number.isFinite(value) && dates[key]?.[row.month])
          line.textContent += ` · 报价日期：${dates[key][row.month]}`;
        tip.append(line);
      }
      const x = left + index * plotWidth / Math.max(1, rows.length - 1);
      guide.setAttribute("x1", x);
      guide.setAttribute("x2", x);
      guide.setAttribute("visibility", "visible");
      tip.hidden = false;
      const bounds = box.getBoundingClientRect(), gap = 12;
      tip.style.left = Math.max(0, Math.min(px + gap, bounds.width - tip.offsetWidth)) + "px";
      tip.style.top = Math.max(0, Math.min(py + gap, bounds.height - tip.offsetHeight)) + "px";
    };
    box.onpointermove = (event) => {
      const bounds = svg.getBoundingClientRect(),
        px = event.clientX - bounds.left, py = event.clientY - bounds.top,
        x = px * width / bounds.width, y = py * height / bounds.height;
      if (x < left || x > width - right || y < top || y > height - bottom)
        return hide();
      box.chartHoverPosition = { clientX: event.clientX, clientY: event.clientY };
      const index = Math.max(0, Math.min(rows.length - 1,
        Math.round((x - left) / plotWidth * (rows.length - 1))));
      show(index, px, py);
    };
    box.onpointerleave = hide;
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", (svg.getAttribute?.("aria-label") || "价格曲线") +
      "；悬停或使用左右方向键查看月份数值，Escape关闭提示");
    svg.onkeydown = (event) => {
      if (event.key === "Escape") return hide();
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !rows.length) return;
      event.preventDefault();
      const index = selected < 0 ? 0 : Math.max(0, Math.min(rows.length - 1,
        selected + (event.key === "ArrowRight" ? 1 : -1)));
      const bounds = svg.getBoundingClientRect();
      show(index, (left + index * plotWidth / Math.max(1, rows.length - 1)) * bounds.width / width,
        top * bounds.height / height);
    };
    svg.onblur = hide;
    if (box.chartHoverPosition) box.onpointermove(box.chartHoverPosition);
  }
  if (typeof module !== "undefined")
    module.exports = { chart, skipGap, parseQuotes, seriesStyle, attachHover };
  if (!root.document) return;
  root.MarketQuotes = { chart, skipGap, parseQuotes, seriesStyle, attachHover, mount };
  function mount({ api, render }) {
    const $ = (id) => document.getElementById(id),
      n = (tag, text) => {
        const x = document.createElement(tag);
        if (text != null) x.textContent = text;
        return x;
      };
    const localMonth = () => localDay().slice(0, 7);
    $("usdQuoteDate").value = localDay();
    let state,
      signature = "",
      viewSignature = "",
      busy = false,
      dirty = new Set(),
      cupTimer,
      cupBusy = false,
      cupVersion = 0;
    $("marketAnchor").value = localMonth();
    const message = (text) => {
      $("marketStatus").textContent = text;
      $("parseStatus").textContent = text;
    };
    async function save(path, payload) {
      if (busy) {
        message("正在保存，请稍后再试");
        return false;
      }
      busy = true;
      message("正在保存到本机数据库…");
      try {
        const s = await api(path, payload);
        render(s);
        const rows = payload.quotes || (payload.price ? [payload] : []),
          shown = rows.filter((q) => (q.quote_date || quoteDayFor(s)) === quoteDayFor(s)).length;
        message(rows.length
          ? `已保存 ${rows.length} 条报价；${shown} 条显示在图中` +
            (shown < rows.length ? `，${rows.length - shown} 条其他日期报价已存入历史。` : "。历史报价继续保存在数据库中。")
          : path === "/api/market/view" ? `已切换至 ${quoteDayFor(s) || "暂无报价"}`
          : "已保存到本机 · " + new Date().toLocaleTimeString());
        return true;
      } catch (e) {
        message(e.message);
        return false;
      } finally {
        busy = false;
      }
    }
    $("marketDisplayDate").onchange = async () => {
      const select = $("marketDisplayDate"), selected = select.value;
      select.disabled = true;
      try {
        if (!await save("/api/market/view", { date: selected }))
          select.value = state.market_view_date || "latest";
      } finally { select.disabled = false; }
    };
    function cnyRows() {
      if (!state || dirty.size) return;
      const anchor = $("marketAnchor").value;
      if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(anchor)) return;
      const [y, m] = anchor.split("-").map(Number);
      $("cnyInputs").replaceChildren(
        ...Array.from({ length: 12 }, (_, i) => {
          const month =
              y + (i + 1 < m ? 1 : 0) + "-" + String(i + 1).padStart(2, "0"),
            q = displayedQuotes(state).find(
              (q) =>
                q.currency === "CNY" && q.name === "人混" && q.month === month,
            ),
            tr = n("tr"),
            input = n("input"),
            quoteDay = n("input"),
            status = n("td", q ? q.updated_at.replace("T", " ") : "未录入"),
            button = n("button", "保存");
          input.type = "number";
          input.min = "0.01";
          input.max = "1000000000";
          input.step = "0.01";
          input.value = q?.price ?? "";
          input.setAttribute("aria-label", month + " 人混均价");
          input.style.width = "130px";
          input.oninput = () => dirty.add(month);
          quoteDay.type = "date";
          quoteDay.required = true;
          quoteDay.value = q?.quote_date || state.market_today || localDay();
          quoteDay.setAttribute("aria-label", month + " 人混报价日期");
          quoteDay.style.width = "140px";
          quoteDay.oninput = () => dirty.add(month);
          button.type = "button";
          button.setAttribute("aria-label", "保存 " + month);
          button.onclick = async () => {
            if (!input.value || !input.checkValidity()) {
              message("请输入有效的人混均价");
              return;
            }
            if (!quoteDay.checkValidity() || !quoteDay.value) {
              message("请选择有效的报价日期");
              return;
            }
            const submitted = input.value,
              submittedDate = quoteDay.value;
            const ok = await save("/api/market/save", {
              name: "人混",
              currency: "CNY",
              month,
              price: submitted,
              quote_date: submittedDate,
            });
            if (
              ok &&
              input.value === submitted &&
              quoteDay.value === submittedDate
            ) {
              dirty.delete(month);
              if (!dirty.size) cnyRows();
              else status.textContent = "已保存";
            } else if (ok)
              status.textContent = "先前报价已保存，当前修改尚未保存";
          };
          const cell = n("td");
          cell.append(input);
          const dateCell = n("td");
          dateCell.append(quoteDay);
          tr.append(n("td", month), cell, dateCell, status);
          const td = n("td");
          td.append(button);
          tr.append(td);
          return tr;
        }),
      );
    }
    $("marketAnchor").onchange = () => {
      dirty.clear();
      if (typeof invalidate === "function") invalidate();
      cnyRows();
    };
    $("usdEntry").onsubmit = async (e) => {
      e.preventDefault();
      const submitted = JSON.stringify([
        $("usdName").value,
        $("usdMonth").value,
        $("usdPrice").value,
        $("usdQuoteDate").value,
      ]);
      const ok = await save("/api/market/save", {
        name: $("usdName").value,
        currency: "USD",
        month: $("usdMonth").value,
        price: $("usdPrice").value,
        quote_date: $("usdQuoteDate").value,
      });
      if (
        ok &&
        submitted ===
          JSON.stringify([
            $("usdName").value,
            $("usdMonth").value,
            $("usdPrice").value,
            $("usdQuoteDate").value,
          ])
      )
        $("usdPrice").value = "";
    };
    let preview = [];
    const invalidate = () => {
      preview = [];
      $("addParsed").disabled = true;
      $("parseStatus").textContent = "";
      $("parsePreview").textContent = "文本修改后请重新解析";
    };
    $("quoteText").oninput = invalidate;
    $("parseCurrency").onchange = invalidate;
    $("parseQuotes").onclick = () => {
      const result = parseQuotes(
        $("quoteText").value,
        $("marketAnchor").value,
        $("parseCurrency").value,
      );
      preview = result.errors.length ? [] : result.quotes;
      $("parseStatus").textContent = result.errors.length
        ? `有 ${result.errors.length} 处内容需修改，暂未添加。请查看下方错误后重新解析。`
        : preview.length ? `已识别 ${preview.length} 条报价，请点击添加。` : "未识别到报价";
      $("parsePreview").textContent =
        [
          result.date
            ? "报价日期：" + result.date
            : "未标报价日期：保存时采用当天日期（北京时间）",
          ...result.quotes.map(
            (q) =>
              `${q.name} · ${q.month || "现货"} · ${q.currency} ${q.price.toFixed(2)}`,
          ),
          ...result.notes.map((note) => "备注：" + note),
          ...result.errors,
        ].join("\n") || "未识别到报价";
      $("addParsed").disabled = !preview.length;
    };
    $("addParsed").onclick = async () => {
      if (!preview.length) return;
      const submitted = preview;
      $("addParsed").disabled = true;
      const ok = await save("/api/market/batch", { quotes: submitted });
      if (ok && preview === submitted) {
        preview = [];
      }
      $("addParsed").disabled = !preview.length;
    };
    function quoteList() {
      $("marketList").replaceChildren(
        ...displayedQuotes(state).map((q) => {
          const tr = n("tr");
          tr.append(
            n("td", q.name),
            n("td", q.month || "现货"),
            n("td", q.currency),
            n("td", q.price.toFixed(2)),
            n("td", q.quote_date || "未标日期"),
            n("td", q.updated_at.replace("T", " ")),
          );
          const td = n("td");
          if (q.currency === "USD") {
            const edit = n("button", "编辑");
            edit.onclick = () => {
              $("usdName").value = q.name;
              $("usdMonth").value = q.month;
              $("usdPrice").value = q.price;
              $("usdQuoteDate").value = q.quote_date || localDay();
              $("usdPrice").focus();
            };
            td.append(edit);
          }
          const del = n("button", "删除");
          del.onclick = () => save("/api/market/delete", { id: q.id });
          td.append(del);
          tr.append(td);
          return tr;
        }),
      );
    }
    async function saveCup() {
      if (cupBusy) return;
      const input = $("cupInput"),
        version = cupVersion,
        value = input.value;
      if (!value || !input.checkValidity()) {
        $("cupStatus").textContent = "请输入有效的非负价格";
        return;
      }
      cupBusy = true;
      $("cupStatus").textContent = "保存中…";
      try {
        const s = await api("/api/params", { cup: Number(value) });
        render(s);
        if (version === cupVersion) $("cupStatus").textContent = "已自动保存";
      } catch (e) {
        if (version === cupVersion)
          $("cupStatus").textContent = "保存失败：" + e.message;
      } finally {
        cupBusy = false;
        if (version !== cupVersion) saveCup();
      }
    }
    $("cupInput").oninput = () => {
      cupVersion++;
      clearTimeout(cupTimer);
      $("cupStatus").textContent = "待保存";
      cupTimer = setTimeout(() => {
        cupTimer = null;
        saveCup();
      }, 450);
    };
    return {
      update(s) {
        const previousDay = state?.market_today;
        state = s;
        const today = s.market_today || localDay();
        if (!previousDay || (previousDay !== today && $("usdQuoteDate").value === previousDay))
          $("usdQuoteDate").value = today;
        const count = displayedQuotes(s).length;
        $("marketToday").textContent = `图中市场报价日期：${quoteDayFor(s) || "暂无"} · ` +
          (count ? `${count} 条报价` : "暂无已保存报价") + "；跨日继续显示，录入新报价后更新，历史报价保留。";
        const nextView = JSON.stringify([s.market_view_date, s.market_quote_dates, s.market_latest_date]);
        if (viewSignature !== nextView) {
          viewSignature = nextView;
          const latest = n("option", "最新录入" + (s.market_latest_date ? " · " + s.market_latest_date : ""));
          latest.value = "latest";
          $("marketDisplayDate").replaceChildren(latest, ...(s.market_quote_dates || []).map((day) => {
            const option = n("option", day);
            option.value = day;
            return option;
          }));
          $("marketDisplayDate").value = s.market_view_date || "latest";
        }
        $("exportMarketCurrent").hidden = !count;
        $("exportMarketCurrent").href = "/api/market/export.xlsx?date=" + encodeURIComponent(quoteDayFor(s));
        const input = $("cupInput");
        if (document.activeElement !== input && !cupBusy && !cupTimer)
          input.value = s.params.cup;
        // An initial fill is separate from active editing; polling must not replace it.
        if (!input.dataset.loaded) {
          input.value = s.params.cup;
          input.dataset.loaded = "1";
        }
        const next = JSON.stringify([quoteDayFor(s), s.market_quotes]);
        if (signature !== next) {
          signature = next;
          cnyRows();
          quoteList();
        }
      },
    };
  }
})(typeof window === "undefined" ? {} : window);
