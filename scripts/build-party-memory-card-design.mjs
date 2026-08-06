import { writeFileSync } from "node:fs";

const css = `
  :root {
    --canvas: #eef4ff;
    --board: #e4ebf6;
    --surface: #ffffff;
    --surface-muted: #f3f6fb;
    --ink: #18233d;
    --muted: #7483a2;
    --line: #dce5f6;
    --blue: #4b6bff;
    --blue-soft: #e6ebff;
    --navy: #151b3b;
    --lime: #c9f36a;
    --green: #1db991;
    --green-soft: #e4f7ee;
    --amber: #f1a33b;
    --amber-soft: #fff2df;
    --coral: #ff6b8f;
    --coral-soft: #ffe8ef;
    --dark: #091126;
    --white: #ffffff;
    --shadow: 0 22px 46px rgba(58, 86, 152, 0.18);
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    background: var(--canvas);
    color: var(--ink);
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    letter-spacing: 0;
    min-width: 1760px;
  }
  button, input, select, textarea { font: inherit; letter-spacing: 0; }
  button { color: inherit; }

  .board {
    background:
      linear-gradient(rgba(24, 35, 61, 0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(24, 35, 61, 0.045) 1px, transparent 1px),
      var(--board);
    background-size: 32px 32px;
    margin: 0 auto;
    min-height: 2420px;
    padding: 28px 34px 34px;
    width: 1760px;
  }

  .board-header {
    align-items: flex-end;
    display: flex;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .brand { align-items: center; display: flex; gap: 14px; }
  .brand-mark {
    align-items: center;
    background: var(--navy);
    border-radius: 15px;
    color: var(--lime);
    display: flex;
    height: 50px;
    justify-content: center;
    width: 50px;
  }
  .brand-mark i { height: 24px; stroke-width: 2.3; width: 24px; }
  .brand-title {
    font-family: "Manrope", "Noto Sans SC", sans-serif;
    font-size: 26px;
    font-weight: 800;
    line-height: 1.1;
    margin: 0;
  }
  .brand-subtitle { color: #64728e; font-size: 12px; font-weight: 600; margin: 6px 0 0; }
  .version {
    border-left: 3px solid var(--coral);
    color: #6b7892;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.7;
    padding-left: 12px;
    text-align: right;
  }
  .version strong { color: var(--ink); display: block; font-size: 14px; }

  .overview {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(3, 1fr);
    margin-bottom: 20px;
  }
  .overview-card {
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.95);
    border-radius: 14px;
    display: flex;
    gap: 11px;
    padding: 13px 15px;
  }
  .overview-card .oc-icon {
    align-items: center;
    background: var(--green-soft);
    border-radius: 9px;
    color: var(--green);
    display: flex;
    flex: 0 0 34px;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .overview-card .oc-icon.blue { background: var(--blue-soft); color: var(--blue); }
  .overview-card .oc-icon.coral { background: var(--coral-soft); color: var(--coral); }
  .overview-card .oc-icon i { height: 17px; width: 17px; }
  .overview-card strong { display: block; font-size: 12px; font-weight: 900; margin-bottom: 4px; }
  .overview-card p { color: var(--muted); font-size: 10.5px; line-height: 1.6; margin: 0; }

  .stage {
    display: grid;
    gap: 18px;
    grid-template-columns: 320px repeat(3, 420px);
    margin-bottom: 22px;
  }
  .strategy {
    align-self: stretch;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.95);
    border-radius: 16px;
    padding: 18px 16px;
  }
  .strategy h3 { font-size: 15px; font-weight: 900; margin: 0 0 14px; }
  .strategy p { color: var(--muted); font-size: 10.5px; line-height: 1.7; margin: 0 0 14px; }
  .flow-item {
    align-items: flex-start;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 10px;
    padding: 11px 0;
  }
  .flow-num {
    align-items: center;
    background: var(--navy);
    border-radius: 8px;
    color: var(--lime);
    display: flex;
    flex: 0 0 26px;
    font-size: 10px;
    font-weight: 900;
    height: 26px;
    justify-content: center;
    width: 26px;
  }
  .flow-item strong { display: block; font-size: 11px; font-weight: 900; }
  .flow-item span { color: var(--muted); display: block; font-size: 9.5px; line-height: 1.6; margin-top: 3px; }
  .rule-box {
    background: var(--green-soft);
    border-left: 3px solid var(--green);
    border-radius: 10px;
    color: #1c5b3c;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.7;
    margin-top: 12px;
    padding: 10px 11px;
  }
  .rule-box.coral {
    background: var(--coral-soft);
    border-left-color: var(--coral);
    color: #7d3043;
  }
  .principle-list, .scope-list {
    display: grid;
    gap: 9px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .principle-list li, .scope-list li {
    align-items: flex-start;
    color: #4d5a75;
    display: flex;
    font-size: 10.5px;
    gap: 8px;
    line-height: 1.55;
  }
  .principle-list i, .scope-list i {
    color: var(--coral);
    flex: 0 0 auto;
    height: 14px;
    margin-top: 2px;
    width: 14px;
  }
  .scope-list i { color: var(--green); }
  .entry-chip {
    align-items: center;
    background: var(--blue-soft);
    border-radius: 12px;
    color: #3d54b8;
    display: flex;
    font-size: 10px;
    font-weight: 800;
    gap: 8px;
    margin-top: 18px;
    min-height: 42px;
    padding: 9px 11px;
  }
  .entry-chip i { height: 15px; stroke-width: 2.4; width: 15px; }

  .phone-wrap { align-self: start; }
  .phone {
    background: var(--dark);
    border-radius: 38px;
    box-shadow: var(--shadow);
    height: 1020px;
    padding: 10px;
    position: relative;
    width: 410px;
  }
  .phone-screen {
    background: var(--surface-muted);
    border-radius: 29px;
    display: flex;
    flex-direction: column;
    height: 1000px;
    overflow: hidden;
    position: relative;
  }
  .status-row {
    align-items: center;
    display: flex;
    height: 38px;
    justify-content: space-between;
    padding: 0 22px;
    position: relative;
  }
  .status-time {
    font-family: "Manrope", "Noto Sans SC", sans-serif;
    font-size: 11px;
    font-weight: 800;
  }
  .status-icons { align-items: center; display: flex; gap: 5px; }
  .status-icons i { height: 12px; width: 12px; }
  .dynamic-island {
    background: var(--dark);
    border-radius: 14px;
    height: 22px;
    left: 50%;
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    width: 92px;
  }
  .phone-label {
    color: #64728e;
    font-size: 10.5px;
    font-weight: 800;
    margin-top: 10px;
    text-align: center;
  }
  .phone-label b { color: var(--ink); }
  .screen-content { flex: 1; overflow: hidden; position: relative; }

  .app-header {
    align-items: center;
    display: flex;
    height: 50px;
    justify-content: space-between;
    padding: 0 16px;
  }
  .app-title { align-items: center; display: flex; gap: 8px; }
  .app-title .mark {
    align-items: center;
    background: var(--navy);
    border-radius: 9px;
    color: var(--lime);
    display: flex;
    height: 28px;
    justify-content: center;
    width: 28px;
  }
  .app-title .mark i { height: 15px; width: 15px; }
  .app-title strong { font-size: 16px; font-weight: 900; }
  .app-actions { align-items: center; display: flex; gap: 6px; }
  .icon-btn {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    display: flex;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .icon-btn i { height: 16px; width: 16px; }
  .icon-btn.plain { background: transparent; border-color: transparent; }
  .icon-btn.coral { background: var(--coral-soft); border-color: transparent; color: var(--coral); }
  .demo-tag {
    align-items: center;
    background: var(--amber-soft);
    border-radius: 999px;
    color: #9a6411;
    font-size: 8px;
    font-weight: 900;
    padding: 4px 8px;
  }
  .bottom-nav {
    align-items: center;
    background: var(--surface);
    border-top: 1px solid var(--line);
    display: flex;
    flex: 0 0 62px;
    justify-content: space-around;
  }
  .bottom-nav span {
    align-items: center;
    color: #8f9bbb;
    display: flex;
    flex-direction: column;
    font-size: 8px;
    font-weight: 800;
    gap: 3px;
  }
  .bottom-nav span.active { color: var(--blue); }
  .bottom-nav i { height: 17px; width: 17px; }

  .search-shell { padding: 4px 16px 0; }
  .search-field {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    gap: 8px;
    height: 42px;
    padding: 0 12px;
  }
  .search-field i { color: var(--blue); height: 16px; width: 16px; }
  .search-field input {
    background: transparent;
    border: 0;
    color: var(--ink);
    flex: 1;
    font-size: 11px;
    font-weight: 700;
    outline: none;
  }
  .search-field input::placeholder { color: #9aa7c2; }
  .search-meta { color: var(--muted); font-size: 8.5px; font-weight: 700; margin: 8px 2px 10px; }
  .section-head { align-items: center; display: flex; justify-content: space-between; margin-bottom: 8px; }
  .section-head h3 { font-size: 12px; font-weight: 900; margin: 0; }
  .section-head span { color: var(--muted); font-size: 8.5px; font-weight: 700; }
  .block { margin: 14px 16px 0; }

  .empty-hero {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    margin: 16px;
    padding: 32px 18px 28px;
    text-align: center;
  }
  .empty-icon {
    align-items: center;
    background: var(--coral-soft);
    border-radius: 18px;
    color: var(--coral);
    display: flex;
    height: 76px;
    justify-content: center;
    margin-bottom: 16px;
    width: 76px;
  }
  .empty-icon i { height: 34px; stroke-width: 1.7; width: 34px; }
  .empty-hero h2 { font-size: 15px; font-weight: 900; margin: 0; }
  .empty-hero p { color: var(--muted); font-size: 9.5px; line-height: 1.7; margin: 7px 0 14px; }
  .cta-row { display: flex; gap: 8px; width: 100%; }
  .cta {
    align-items: center;
    border: 0;
    border-radius: 10px;
    display: inline-flex;
    font-size: 10.5px;
    font-weight: 900;
    gap: 6px;
    height: 40px;
    justify-content: center;
    padding: 0 14px;
  }
  .cta i { height: 14px; width: 14px; }
  .cta.primary { background: var(--blue); color: var(--white); }
  .cta.ghost { background: var(--surface); border: 1px solid var(--line); color: var(--ink); }
  .cta.dark { background: var(--navy); color: var(--white); }
  .cta.coral { background: var(--coral); color: var(--white); }
  .cta.green { background: var(--green); color: var(--white); }
  .cta.block { width: 100%; }
  .cta-row .cta { flex: 1; }
  .real-note {
    align-items: center;
    background: var(--blue-soft);
    border-radius: 10px;
    color: #3d54b8;
    display: flex;
    font-size: 8.5px;
    font-weight: 800;
    gap: 6px;
    margin: 12px 16px 0;
    padding: 9px 11px;
  }
  .real-note i { height: 13px; width: 13px; }

  .zero-stats {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(3, 1fr);
    margin: 14px 16px 0;
  }
  .zero-stat {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 6px;
  }
  .zero-stat strong { font-family: "Manrope", "Noto Sans SC", sans-serif; font-size: 15px; }
  .zero-stat span { color: var(--muted); font-size: 8px; font-weight: 800; }

  .step-strip {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    margin: 0 16px 12px;
    padding: 8px 10px;
  }
  .step {
    align-items: center;
    color: var(--muted);
    display: flex;
    flex: 1;
    font-size: 9px;
    font-weight: 800;
    gap: 5px;
  }
  .step .dot {
    align-items: center;
    background: var(--line);
    border-radius: 50%;
    color: var(--white);
    display: flex;
    font-size: 8px;
    height: 18px;
    justify-content: center;
    width: 18px;
  }
  .step.active { color: var(--ink); }
  .step.active .dot { background: var(--blue); }
  .step.done .dot { background: var(--green); }
  .step-line { background: var(--line); border-radius: 2px; flex: 1; height: 2px; }
  .step-line.filled { background: var(--green); }

  .form-shell { display: grid; gap: 12px; margin: 0 16px; }
  .field { display: grid; gap: 6px; }
  .field label { color: #4d5a75; font-size: 9px; font-weight: 900; }
  .field label em { color: var(--coral); font-style: normal; }
  .field input, .field select, .field textarea {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 11px;
    color: var(--ink);
    font-size: 10px;
    font-weight: 700;
    min-height: 40px;
    outline: none;
    padding: 0 11px;
    width: 100%;
  }
  .field textarea { min-height: 72px; padding: 9px 11px; resize: none; }
  .field .hint { color: var(--muted); font-size: 8px; font-weight: 700; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    color: #4d5a75;
    display: inline-flex;
    font-size: 8.5px;
    font-weight: 800;
    gap: 5px;
    min-height: 30px;
    padding: 0 10px;
  }
  .chip.active { background: var(--navy); border-color: var(--navy); color: var(--white); }
  .chip.active i { color: var(--lime); }
  .chip.green { background: var(--green-soft); border-color: transparent; color: #14795e; }
  .chip.amber { background: var(--amber-soft); border-color: transparent; color: #9a6411; }
  .chip.coral { background: var(--coral-soft); border-color: transparent; color: #c14b6c; }
  .chip.add { border-style: dashed; color: var(--blue); }
  .chip i { height: 12px; width: 12px; }

  .photo-grid {
    display: grid;
    gap: 7px;
    grid-template-columns: repeat(4, 1fr);
  }
  .photo-tile {
    align-items: center;
    aspect-ratio: 1;
    background: var(--blue-soft);
    border: 1px solid var(--line);
    border-radius: 11px;
    color: var(--blue);
    display: flex;
    justify-content: center;
    min-height: 60px;
    position: relative;
  }
  .photo-tile.green { background: var(--green-soft); color: var(--green); }
  .photo-tile.coral { background: var(--coral-soft); color: var(--coral); }
  .photo-tile.amber { background: var(--amber-soft); color: var(--amber); }
  .photo-tile.add { background: var(--surface); border-style: dashed; color: var(--blue); }
  .photo-tile i { height: 20px; width: 20px; }
  .photo-tile .photo-count {
    background: var(--navy);
    border-radius: 999px;
    bottom: 4px;
    color: var(--white);
    font-size: 7px;
    font-weight: 900;
    padding: 2px 5px;
    position: absolute;
    right: 4px;
  }
  .photo-note { color: var(--muted); font-size: 8px; font-weight: 700; margin: 6px 2px 0; }

  .dish-list { display: grid; gap: 7px; }
  .dish-card {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: grid;
    gap: 8px;
    grid-template-columns: 34px 1fr auto;
    padding: 9px;
  }
  .dish-icon {
    align-items: center;
    background: var(--coral-soft);
    border-radius: 9px;
    color: var(--coral);
    display: flex;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .dish-icon.green { background: var(--green-soft); color: var(--green); }
  .dish-icon.amber { background: var(--amber-soft); color: var(--amber); }
  .dish-icon i { height: 16px; width: 16px; }
  .dish-card strong { display: block; font-size: 10px; font-weight: 900; }
  .dish-card span { color: var(--muted); display: block; font-size: 8px; font-weight: 700; margin-top: 2px; }
  .dish-price { color: var(--ink); font-size: 9.5px; font-weight: 900; }
  .rate-chip {
    align-items: center;
    background: var(--green-soft);
    border-radius: 999px;
    color: #14795e;
    display: inline-flex;
    font-size: 7.5px;
    font-weight: 900;
    gap: 3px;
    padding: 3px 6px;
  }
  .rate-chip i { height: 9px; width: 9px; }

  .expense-card {
    align-items: center;
    background: var(--navy);
    border-radius: 13px;
    color: var(--white);
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 12px;
  }
  .expense-card .amount { font-family: "Manrope", "Noto Sans SC", sans-serif; font-size: 20px; font-weight: 800; }
  .expense-card .amount small { color: #b9c4df; font-size: 9px; margin-left: 3px; }
  .expense-card .meta { color: #b9c4df; font-size: 8.5px; font-weight: 700; text-align: right; }
  .expense-card .meta b { color: var(--lime); display: block; font-size: 10px; }

  .detail-cover {
    align-items: flex-end;
    background: linear-gradient(135deg, var(--navy), #31406e);
    color: var(--white);
    display: flex;
    margin: 0 16px;
    min-height: 150px;
    padding: 16px;
    position: relative;
    border-radius: 15px;
  }
  .detail-cover i.cover-icon {
    background: rgba(255, 255, 255, 0.14);
    border-radius: 14px;
    height: 54px;
    left: 16px;
    padding: 15px;
    position: absolute;
    top: 16px;
    width: 54px;
  }
  .detail-cover h2 { font-size: 18px; font-weight: 900; margin: 0; position: relative; z-index: 1; }
  .detail-cover p { color: #c8d2ee; font-size: 9px; font-weight: 700; margin: 4px 0 0; position: relative; z-index: 1; }
  .detail-cover .cover-meta {
    align-items: center;
    display: flex;
    gap: 6px;
    margin-top: 8px;
    position: relative;
    z-index: 1;
  }
  .detail-cover .cover-meta span {
    align-items: center;
    background: rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    display: inline-flex;
    font-size: 7.5px;
    gap: 4px;
    padding: 4px 7px;
  }
  .detail-cover .cover-meta i { height: 10px; width: 10px; }
  .cover-photo-strip {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(3, 1fr);
    margin: 12px 16px 0;
  }
  .cover-photo-strip .photo-tile { min-height: 76px; }
  .avatar-stack { align-items: center; display: flex; gap: 5px; }
  .avatar {
    align-items: center;
    background: var(--blue-soft);
    border: 2px solid var(--surface);
    border-radius: 50%;
    color: var(--blue);
    display: flex;
    font-size: 8px;
    font-weight: 900;
    height: 28px;
    justify-content: center;
    width: 28px;
  }
  .avatar.coral { background: var(--coral-soft); color: var(--coral); }
  .avatar.green { background: var(--green-soft); color: var(--green); }
  .avatar.amber { background: var(--amber-soft); color: var(--amber); }
  .avatar.more { background: var(--navy); color: var(--lime); }

  .tab-row {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    margin: 12px 16px 0;
    padding: 4px;
  }
  .tab {
    color: var(--muted);
    flex: 1;
    font-size: 9px;
    font-weight: 900;
    padding: 8px 4px;
    text-align: center;
  }
  .tab.active { background: var(--blue); border-radius: 9px; color: var(--white); }

  .fact-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 13px;
    padding: 12px;
  }
  .fact-row {
    align-items: flex-start;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 9px;
    padding: 9px 0;
  }
  .fact-row:first-child { border-top: 0; }
  .fact-icon {
    align-items: center;
    background: var(--green-soft);
    border-radius: 9px;
    color: var(--green);
    display: flex;
    flex: 0 0 30px;
    height: 30px;
    justify-content: center;
    width: 30px;
  }
  .fact-icon.coral { background: var(--coral-soft); color: var(--coral); }
  .fact-icon.amber { background: var(--amber-soft); color: var(--amber); }
  .fact-icon.blue { background: var(--blue-soft); color: var(--blue); }
  .fact-icon i { height: 14px; width: 14px; }
  .fact-row strong { display: block; font-size: 10px; font-weight: 900; }
  .fact-row p { color: var(--muted); font-size: 8.5px; line-height: 1.6; margin: 3px 0 0; }
  .fact-row .fact-action { color: var(--blue); font-size: 8px; font-weight: 900; margin-left: auto; }

  .vote-row { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); }
  .vote-box {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 6px;
  }
  .vote-box strong { font-family: "Manrope", "Noto Sans SC", sans-serif; font-size: 16px; }
  .vote-box span { color: var(--muted); font-size: 8px; font-weight: 800; }
  .vote-box.green { background: var(--green-soft); border-color: transparent; }
  .vote-box.green strong { color: #14795e; }
  .vote-box.amber { background: var(--amber-soft); border-color: transparent; }
  .vote-box.amber strong { color: #9a6411; }
  .vote-box.coral { background: var(--coral-soft); border-color: transparent; }
  .vote-box.coral strong { color: #c14b6c; }

  .participant-list { display: grid; gap: 8px; }
  .participant-row {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    gap: 9px;
    padding: 9px;
  }
  .participant-main { flex: 1; }
  .participant-main strong { display: block; font-size: 10px; font-weight: 900; }
  .participant-main span { color: var(--muted); display: block; font-size: 8px; font-weight: 700; margin-top: 2px; }
  .status-pill {
    align-items: center;
    background: var(--blue-soft);
    border-radius: 999px;
    color: #3d54b8;
    display: inline-flex;
    font-size: 7.5px;
    font-weight: 900;
    gap: 3px;
    padding: 4px 7px;
  }
  .status-pill.green { background: var(--green-soft); color: #14795e; }
  .status-pill.amber { background: var(--amber-soft); color: #9a6411; }
  .status-pill i { height: 9px; width: 9px; }

  .activity-list { display: grid; gap: 8px; }
  .activity-item {
    align-items: flex-start;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    gap: 9px;
    padding: 9px;
  }
  .activity-item .avatar { flex: 0 0 28px; height: 28px; width: 28px; }
  .activity-main { flex: 1; }
  .activity-main strong { font-size: 9.5px; font-weight: 900; }
  .activity-main strong span { color: #4d5a75; font-weight: 700; }
  .activity-main p { color: var(--muted); font-size: 8px; line-height: 1.5; margin: 3px 0 0; }
  .activity-time { color: #9aa7c2; font-size: 7.5px; font-weight: 700; }

  .summary-card {
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    display: flex;
    gap: 12px;
    margin: 12px 16px 0;
    padding: 12px;
  }
  .summary-icon {
    align-items: center;
    background: var(--coral-soft);
    border-radius: 12px;
    color: var(--coral);
    display: flex;
    flex: 0 0 44px;
    height: 44px;
    justify-content: center;
    width: 44px;
  }
  .summary-icon i { height: 20px; width: 20px; }
  .summary-main { flex: 1; }
  .summary-main strong { display: block; font-size: 12px; font-weight: 900; }
  .summary-main span { color: var(--muted); display: block; font-size: 8.5px; font-weight: 700; margin-top: 3px; }
`;

const lucide = (name, extra = "") => `<i data-lucide="${name}" ${extra}></i>`;

const statusRow = (time) => `
  <div class="status-row">
    <span class="status-time">${time}</span>
    <span class="dynamic-island"></span>
    <span class="status-icons">
      ${lucide("signal")}
      ${lucide("wifi")}
      ${lucide("battery-full")}
    </span>
  </div>`;

const appHeader = ({ markIcon = "party-popper", title, right = "", demo = false }) => `
  <div class="app-header">
    <div class="app-title">
      <div class="mark">${lucide(markIcon)}</div>
      <strong>${title}</strong>
    </div>
    <div class="app-actions">
      ${demo ? '<div class="demo-tag">录入后示意</div>' : ""}
      ${right}
    </div>
  </div>`;

const backHeader = (title, right = "") => `
  <div class="app-header">
    <div class="app-title">
      <div class="icon-btn plain">${lucide("chevron-left")}</div>
      <strong>${title}</strong>
    </div>
    <div class="app-actions">${right}</div>
  </div>`;

const bottomNav = (active = "home") => `
  <div class="bottom-nav">
    <span class="${active === "home" ? "active" : ""}">${lucide("home")}首页</span>
    <span class="${active === "tools" ? "active" : ""}">${lucide("layout-grid")}工具</span>
    <span class="${active === "messages" ? "active" : ""}">${lucide("message-circle")}消息</span>
    <span class="${active === "profile" ? "active" : ""}">${lucide("user")}我的</span>
  </div>`;

const phone = (label, time, content, nav = null) => `
  <div class="phone-wrap">
    <div class="phone">
      <div class="phone-screen">
        ${statusRow(time)}
        <div class="screen-content">${content}</div>
        ${nav || ""}
      </div>
    </div>
    <div class="phone-label">${label}</div>
  </div>`;

const section = (title, meta, inner) => `
  <div class="block">
    <div class="section-head">
      <h3>${title}</h3>
      <span>${meta}</span>
    </div>
    ${inner}
  </div>`;

const field = (label, required, control, hint = "") => `
  <div class="field">
    <label>${label} ${required ? "<em>*</em>" : ""}</label>
    ${control}
    ${hint ? `<span class="hint">${hint}</span>` : ""}
  </div>`;

const stageOneStrategy = `
  <aside class="strategy">
    <h3>一次聚会，一张真实记忆卡</h3>
    <p>聚会结束后，把参与者、餐厅、账单、照片、菜品评价和下次意愿收进同一张卡。下次聚餐前，直接查看上次的真实记录。</p>
    <div class="flow-item">
      <div class="flow-num">1</div>
      <div>
        <strong>记录聚会</strong>
        <span>日期、餐厅、参与人、谁请客、真实金额与照片</span>
      </div>
    </div>
    <div class="flow-item">
      <div class="flow-num">2</div>
      <div>
        <strong>补充内容</strong>
        <span>菜品口碑、停车/环境印象、下次是否还去</span>
      </div>
    </div>
    <div class="flow-item">
      <div class="flow-num">3</div>
      <div>
        <strong>下次准备</strong>
        <span>按真实最近一次记录展示请客轮换、餐厅事实和投票</span>
      </div>
    </div>
    <div class="rule-box">
      首启为空；不预置聚会、照片、账单、餐厅或评价。所有展示内容只来自真实录入。
    </div>
  </aside>`;

const stageTwoStrategy = `
  <aside class="strategy">
    <h3>真实数据规则</h3>
    <ul class="principle-list">
      <li>${lucide("circle-check")}参与者来自真实输入，或当前账号真实好友</li>
      <li>${lucide("circle-check")}餐厅、菜品、评价、停车情况全部由用户真实录入</li>
      <li>${lucide("circle-check")}账单金额由用户填写，人均由服务端按真实人数计算</li>
      <li>${lucide("circle-check")}“下次还去”由参与人真实投票，无投票则显示“暂无投票”</li>
      <li>${lucide("circle-check")}下次准备页只引用最近一次真实卡片，不生成 AI 建议</li>
    </ul>
    <div class="rule-box coral">
      同一版本交付记账、相册、协作与下次准备，不拆分期。
    </div>
  </aside>`;

const phoneHomeEmpty = phone(
  `<b>首次进入</b> · 真实空态，无 mock 数据`,
  "20:08",
  `
    ${appHeader({
      title: "聚会记忆卡",
      right: `${lucide("history")}${lucide("share-2")}<div class="icon-btn coral">${lucide("plus")}</div>`,
    })}
    <div class="search-shell">
      <div class="search-field">
        ${lucide("search")}
        <input placeholder="搜索餐厅、参与人、菜名" readonly />
      </div>
    </div>
    <div class="zero-stats">
      <div class="zero-stat"><strong>0</strong><span>次聚会</span></div>
      <div class="zero-stat"><strong>0</strong><span>张照片</span></div>
      <div class="zero-stat"><strong>0</strong><span>条印象</span></div>
    </div>
    <div class="empty-hero">
      <div class="empty-icon">${lucide("party-popper")}</div>
      <h2>还没有聚会记忆卡</h2>
      <p>记录一场真实聚会后，这里会出现第一张卡。</p>
      <div class="cta-row">
        <button class="cta primary" type="button">${lucide("camera")}拍照记录</button>
        <button class="cta ghost" type="button">${lucide("pen-line")}手动记录</button>
      </div>
    </div>
    <div class="real-note">${lucide("database")}首次进入不预置聚会、照片、账单或印象。</div>
  `,
  bottomNav("home")
);

const phoneRecordBasics = phone(
  `<b>记录聚会</b> · 基本信息，必填项来自真实输入`,
  "20:09",
  `
    ${backHeader("记录聚会", '<span style="color:var(--blue);font-size:10px;font-weight:900">下一步</span>')}
    <div class="step-strip">
      <div class="step active"><span class="dot">1</span>基本信息</div>
      <div class="step-line"></div>
      <div class="step"><span class="dot">2</span>照片账单</div>
      <div class="step-line"></div>
      <div class="step"><span class="dot">3</span>印象评价</div>
    </div>
    <div class="form-shell">
      ${field("聚会日期", true, `<input value="2026-08-06 20:30" />`)}
      ${field("聚会主题", false, `<input value="8月老友聚餐" placeholder="可选" />`)}
      ${field("餐厅 / 地点", true, `<input value="川香居" placeholder="真实餐厅或地点名称" />`, "地址可在下一步补充")}
      ${field(
        "参与人",
        true,
        `<div class="chip-row">
          <span class="chip active">王明</span>
          <span class="chip">李雷</span>
          <span class="chip">韩梅梅</span>
          <span class="chip add">${lucide("user-plus")}添加</span>
        </div>`,
        "从真实好友选择，或输入真实姓名/昵称"
      )}
      ${field(
        "谁请客",
        true,
        `<select><option>王明</option><option>AA 分摊</option><option>其他人</option></select>`
      )}
    </div>
    <div style="margin:14px 16px 0">
      <button class="cta primary block" type="button">${lucide("arrow-right")}下一步：照片与账单</button>
    </div>
  `
);

const phoneRecordContent = phone(
  `<b>记录聚会</b> · 照片、账单与印象全部真实录入`,
  "20:10",
  `
    ${backHeader("照片与账单", '<span style="color:var(--blue);font-size:10px;font-weight:900">保存</span>')}
    <div class="step-strip">
      <div class="step done"><span class="dot">${lucide("check")}</span>基本信息</div>
      <div class="step-line filled"></div>
      <div class="step active"><span class="dot">2</span>照片账单</div>
      <div class="step-line"></div>
      <div class="step"><span class="dot">3</span>印象评价</div>
    </div>
    <div class="block">
      <div class="section-head"><h3>真实照片</h3><span>拍照或相册上传</span></div>
      <div class="photo-grid">
        <div class="photo-tile">${lucide("utensils")}<span class="photo-count">封面</span></div>
        <div class="photo-tile green">${lucide("users")}</div>
        <div class="photo-tile amber">${lucide("beer")}</div>
        <div class="photo-tile add">${lucide("plus")}</div>
      </div>
    </div>
    <div class="block">
      <div class="section-head"><h3>点的菜</h3><span>真实菜名与评价</span></div>
      <div class="dish-list">
        <div class="dish-card">
          <div class="dish-icon">${lucide("fish")}</div>
          <div><strong>烤鱼</strong><span>3 人觉得好吃</span></div>
          <div style="text-align:right"><div class="dish-price">¥168</div><span class="rate-chip">${lucide("thumbs-up")}好吃</span></div>
        </div>
        <div class="dish-card">
          <div class="dish-icon green">${lucide("salad")}</div>
          <div><strong>口水鸡</strong><span>1 人觉得一般</span></div>
          <div style="text-align:right"><div class="dish-price">¥58</div><span class="rate-chip">${lucide("minus")}一般</span></div>
        </div>
      </div>
    </div>
    <div class="block">
      <div class="expense-card">
        <div>
          <div style="font-size:8px;color:#b9c4df;font-weight:800">总费用</div>
          <div class="amount">486<small>元</small></div>
        </div>
        <div class="meta">
          <b>王明请客</b>
          4 人 · 人均 121.5 元
        </div>
      </div>
    </div>
  `
);

const phoneDetail = phone(
  `<b>记忆卡详情</b> · 相册、账单、菜品与印象在一张卡内`,
  "20:11",
  `
    ${appHeader({
      title: "8月老友聚餐",
      markIcon: "book-heart",
      right: `${lucide("share-2")}<div class="icon-btn coral">${lucide("more-horizontal")}</div>`,
      demo: true,
    })}
    <div class="detail-cover">
      ${lucide("utensils", 'class="cover-icon"')}
      <div>
        <h2>川香居</h2>
        <p>滨江路 18 号 · 2026-08-06 20:30</p>
        <div class="cover-meta">
          <span>${lucide("users")}4 人</span>
          <span>${lucide("camera")}6 张照片</span>
          <span>${lucide("crown")}王明请客</span>
        </div>
      </div>
    </div>
    <div class="cover-photo-strip">
      <div class="photo-tile">${lucide("utensils")}</div>
      <div class="photo-tile green">${lucide("users")}</div>
      <div class="photo-tile amber">${lucide("beer")}</div>
    </div>
    <div class="tab-row">
      <div class="tab active">记忆</div>
      <div class="tab">账单</div>
      <div class="tab">印象</div>
      <div class="tab">下次</div>
    </div>
    ${section("参与人", "真实成员", `
      <div class="avatar-stack">
        <div class="avatar">王</div>
        <div class="avatar coral">李</div>
        <div class="avatar green">韩</div>
        <div class="avatar amber">赵</div>
      </div>
    `)}
    ${section("点的菜", "真实评价", `
      <div class="dish-list">
        <div class="dish-card">
          <div class="dish-icon">${lucide("fish")}</div>
          <div><strong>烤鱼</strong><span>3 人好评 · 王明/李雷/韩梅梅</span></div>
          <div style="text-align:right"><div class="dish-price">¥168</div><span class="rate-chip">${lucide("thumbs-up")}好吃</span></div>
        </div>
        <div class="dish-card">
          <div class="dish-icon green">${lucide("salad")}</div>
          <div><strong>口水鸡</strong><span>1 人觉得一般</span></div>
          <div style="text-align:right"><div class="dish-price">¥58</div><span class="rate-chip">${lucide("minus")}一般</span></div>
        </div>
      </div>
    `)}
  `
);

const phoneNextPrep = phone(
  `<b>下次聚餐准备</b> · 只引用最近一次真实记忆卡`,
  "20:12",
  `
    ${appHeader({
      title: "下次聚餐",
      right: '<span style="color:var(--blue);font-size:10px;font-weight:900">发起新聚会</span>',
    })}
    <div class="summary-card">
      <div class="summary-icon">${lucide("party-popper")}</div>
      <div class="summary-main">
        <strong>川香居 · 8月6日</strong>
        <span>最近一次真实聚会 · 王明请客</span>
      </div>
    </div>
    <div class="block">
      <div class="fact-card">
        <div class="fact-row">
          <div class="fact-icon coral">${lucide("crown")}</div>
          <div>
            <strong>上次由王明请客</strong>
            <p>本次可以换一位真实参与人</p>
          </div>
          <span class="fact-action">选择请客人</span>
        </div>
        <div class="fact-row">
          <div class="fact-icon amber">${lucide("car")}</div>
          <div>
            <strong>停车不方便</strong>
            <p>来自 2 位参与人的真实印象</p>
          </div>
          <span class="fact-action">查看详情</span>
        </div>
        <div class="fact-row">
          <div class="fact-icon">${lucide("fish")}</div>
          <div>
            <strong>烤鱼评价不错</strong>
            <p>3 人真实好评 · 下次仍可点</p>
          </div>
          <span class="fact-action">查看菜品</span>
        </div>
        <div class="fact-row">
          <div class="fact-icon blue">${lucide("wallet")}</div>
          <div>
            <strong>人均 121.5 元</strong>
            <p>总费用 486 元 ÷ 4 位真实参与人</p>
          </div>
        </div>
      </div>
    </div>
    ${section("大家还想来吗", "真实投票", `
      <div class="vote-row">
        <div class="vote-box green"><strong>6</strong><span>想去</span></div>
        <div class="vote-box amber"><strong>1</strong><span>一般</span></div>
        <div class="vote-box coral"><strong>0</strong><span>不想去</span></div>
      </div>
    `)}
    <div class="real-note">${lucide("database")}请客、停车、菜品与投票均来自真实记录。</div>
  `
);

const phoneCollaboration = phone(
  `<b>协作记录</b> · 真实参与人共同补充`,
  "20:13",
  `
    ${backHeader("川香居 · 8月6日", '<span style="color:var(--blue);font-size:10px;font-weight:900">完成</span>')}
    <div class="block">
      <div class="section-head"><h3>参与人</h3><span>真实好友 / 手动输入</span></div>
      <div class="participant-list">
        <div class="participant-row">
          <div class="avatar">王</div>
          <div class="participant-main"><strong>王明</strong><span>请客 · 已上传 2 张照片</span></div>
          <span class="status-pill green">${lucide("check")}已协作</span>
        </div>
        <div class="participant-row">
          <div class="avatar coral">李</div>
          <div class="participant-main"><strong>李雷</strong><span>已给烤鱼好评 · 已投票</span></div>
          <span class="status-pill green">${lucide("check")}已协作</span>
        </div>
        <div class="participant-row">
          <div class="avatar amber">韩</div>
          <div class="participant-main"><strong>韩梅梅</strong><span>标记停车不好停</span></div>
          <span class="status-pill amber">${lucide("clock")}待补充</span>
        </div>
      </div>
    </div>
    <div class="block">
      <div class="section-head"><h3>真实动态</h3><span>仅展示实际发生的操作</span></div>
      <div class="activity-list">
        <div class="activity-item">
          <div class="avatar coral">李</div>
          <div class="activity-main"><strong>李雷 <span>上传了 2 张照片</span></strong><p>餐厅环境与合影</p></div>
          <span class="activity-time">20:41</span>
        </div>
        <div class="activity-item">
          <div class="avatar">王</div>
          <div class="activity-main"><strong>王明 <span>确认总费用 486 元</span></strong><p>真实账单金额</p></div>
          <span class="activity-time">20:35</span>
        </div>
        <div class="activity-item">
          <div class="avatar amber">韩</div>
          <div class="activity-main"><strong>韩梅梅 <span>给烤鱼点了好评</span></strong><p>下次还想再点</p></div>
          <span class="activity-time">20:28</span>
        </div>
      </div>
    </div>
    <div style="margin:14px 16px 0">
      <button class="cta ghost block" type="button">${lucide("user-plus")}邀请参与人</button>
    </div>
  `
);

const phoneSearchList = phone(
  `<b>历史卡片</b> · 按真实字段搜索与筛选`,
  "20:14",
  `
    ${appHeader({
      title: "我的记忆卡",
      right: `<div class="icon-btn coral">${lucide("plus")}</div>`,
    })}
    <div class="search-shell">
      <div class="search-field">
        ${lucide("search")}
        <input value="川香居" readonly />
        ${lucide("x")}
      </div>
      <p class="search-meta">餐厅 / 参与人 / 菜名 · 3 条真实记录</p>
    </div>
    <div class="block">
      <div class="chip-row">
        <span class="chip active">全部</span>
        <span class="chip">请客</span>
        <span class="chip">AA</span>
        <span class="chip">想去</span>
        <span class="chip">有照片</span>
      </div>
    </div>
    <div class="block">
      <div class="dish-list">
        <div class="dish-card">
          <div class="dish-icon">${lucide("utensils")}</div>
          <div><strong>川香居</strong><span>2026-08-06 · 王明请客 · 烤鱼好评</span></div>
          <span class="rate-chip">${lucide("thumbs-up")}想去</span>
        </div>
        <div class="dish-card">
          <div class="dish-icon green">${lucide("store")}</div>
          <div><strong>老码头火锅</strong><span>2026-07-21 · AA · 人均 98 元</span></div>
          <span class="rate-chip">${lucide("minus")}一般</span>
        </div>
        <div class="dish-card">
          <div class="dish-icon amber">${lucide("beer")}</div>
          <div><strong>路边烧烤</strong><span>2026-07-02 · 李雷请客 · 6 张照片</span></div>
          <span class="rate-chip">${lucide("thumbs-up")}想去</span>
        </div>
      </div>
    </div>
    <div class="real-note">${lucide("database")}列表只返回当前用户真实创建或共享的记忆卡。</div>
  `,
  bottomNav("tools")
);

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FunBox 聚会记忆卡 产品设计 V1</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700;800;900&display=swap"
      rel="stylesheet" />
    <script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script>
    <style>${css}</style>
  </head>
  <body>
    <div class="board">
      <header class="board-header">
        <div class="brand">
          <div class="brand-mark">${lucide("party-popper")}</div>
          <div>
            <h1 class="brand-title">聚会记忆卡</h1>
            <p class="brand-subtitle">FunBox 产品设计 V1 · 记账 + 相册 + 社交记忆 + 下次准备</p>
          </div>
        </div>
        <div class="version">
          <strong>V1 完整一期</strong>
          日期：2026-08-06 · 状态：待评审
        </div>
      </header>

      <div class="overview">
        <div class="overview-card">
          <div class="oc-icon blue">${lucide("party-popper")}</div>
          <div>
            <strong>一张卡收下整场聚会</strong>
            <p>参与人、餐厅、账单、照片、菜品评价和下次意愿全部落到同一张真实记忆卡。</p>
          </div>
        </div>
        <div class="overview-card">
          <div class="oc-icon coral">${lucide("calendar-clock")}</div>
          <div>
            <strong>下次准备有据可依</strong>
            <p>下次聚餐直接看最近一次真实卡片：谁请客、停车情况、热门菜品、人均和真实投票。</p>
          </div>
        </div>
        <div class="overview-card">
          <div class="oc-icon">${lucide("database")}</div>
          <div>
            <strong>全部真实数据，首启为空</strong>
            <p>不预置 mock 聚会、照片、账单或评价；缺字段显示“暂无”，不做 AI 编造。</p>
          </div>
        </div>
      </div>

      <section class="stage">
        ${stageOneStrategy}
        ${phoneHomeEmpty}
        ${phoneRecordBasics}
        ${phoneRecordContent}
      </section>

      <section class="stage">
        ${stageTwoStrategy}
        ${phoneDetail}
        ${phoneNextPrep}
        ${phoneCollaboration}
      </section>

      <section class="stage">
        <aside class="strategy">
          <h3>一期范围</h3>
          <ul class="scope-list">
            <li>${lucide("check")}记忆卡 CRUD、参与者、餐厅、账单、照片</li>
            <li>${lucide("check")}菜品评价、停车/环境印象、下次投票</li>
            <li>${lucide("check")}真实好友协作、动态、导出备份</li>
            <li>${lucide("check")}下次聚餐准备页与请客轮换提示</li>
            <li>${lucide("check")}搜索、筛选、空态、错误态、权限</li>
          </ul>
          <div class="entry-chip">${lucide("arrow-right")}工具注册名：party-memory-card</div>
        </aside>
        ${phoneSearchList}
        <div class="phone-wrap">
          <div class="phone">
            <div class="phone-screen">
              ${statusRow("20:15")}
              <div class="screen-content">
                <div class="empty-hero" style="margin-top:140px">
                  <div class="empty-icon">${lucide("badge-check")}</div>
                  <h2>设计稿数据说明</h2>
                  <p>本稿出现的餐厅、参与人、金额、照片与评价仅用于表达“录入后界面”的版式。正式产品首次进入为空，运行时所有内容只来自用户真实录入。</p>
                </div>
              </div>
              <div class="bottom-nav">
                <span class="active">${lucide("home")}首页</span>
                <span>${lucide("layout-grid")}工具</span>
                <span>${lucide("message-circle")}消息</span>
                <span>${lucide("user")}我的</span>
              </div>
            </div>
          </div>
          <div class="phone-label"><b>设计稿声明</b> · 示例数据仅用于版式，不进入运行数据</div>
        </div>
      </section>
    </div>
    <script>
      if (window.lucide) {
        lucide.createIcons();
      }
    </script>
  </body>
</html>`;

writeFileSync("C:/Users/Administrator/Documents/funbox/docs/party-memory-card-product-design-v1.html", html, "utf8");
console.log("party memory card design html written");
