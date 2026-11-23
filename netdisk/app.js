(function () {
  'use strict';

  /* ---------- constants ---------- */
  var DB_NAME = 'nebula-drive';
  var DB_VER = 1;
  var STORE = 'files';
  var QUOTA = 4 * 1024 * 1024 * 1024 * 1024; // 4 TB
  var HOME_URL = 'https://37lg0tbp0hx5bkn05t9.traesite.cn';

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function uid() { return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function formatBytes(n) {
    if (!n || n < 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + units[i];
  }

  function formatDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var now = new Date();
    var sameYear = d.getFullYear() === now.getFullYear();
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    if (sameYear) return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  var DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'rtf', 'pages', 'numbers', 'key'];
  var IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic'];
  var VID_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'];
  var AUD_EXT = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];

  function kindOf(f) {
    if (f.kind === 'folder') return 'folder';
    var mime = f.mime || '';
    var ext = extOf(f.name);
    if (mime.indexOf('image/') === 0 || IMG_EXT.indexOf(ext) >= 0) return 'image';
    if (mime.indexOf('video/') === 0 || VID_EXT.indexOf(ext) >= 0) return 'video';
    if (mime.indexOf('audio/') === 0 || AUD_EXT.indexOf(ext) >= 0) return 'audio';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (DOC_EXT.indexOf(ext) >= 0 || mime.indexOf('text/') === 0) return 'doc';
    return 'file';
  }

  var ICON_MAP = { folder: '#i-folder', image: '#i-image', video: '#i-video', audio: '#i-audio', pdf: '#i-pdf', doc: '#i-file', file: '#i-file' };

  function iconEl(kind) {
    return svgUse(ICON_MAP[kind] || '#i-file');
  }

  function svgUse(href) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', href);
    svg.appendChild(use);
    return svg;
  }

  /* ---------- state ---------- */
  var state = {
    view: 'all',        // all | image | video | doc | trash
    folderId: null,
    sort: 'date-desc',
    layout: 'list',
    query: '',
    user: ''
  };
  var files = [];
  var db = null;

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('当前浏览器不支持本地存储')); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('parentId', 'parentId', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGetAll() {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbPut(rec) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function dbPutMany(recs) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var s = tx.objectStore(STORE);
      recs.forEach(function (r) { s.put(r); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function dbDelete(ids) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var s = tx.objectStore(STORE);
      ids.forEach(function (id) { s.delete(id); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* ---------- data helpers ---------- */
  function byId(id) { for (var i = 0; i < files.length; i++) if (files[i].id === id) return files[i]; return null; }

  function childrenOf(folderId) {
    return files.filter(function (f) { return (f.parentId || null) === (folderId || null); });
  }

  function descendantsOf(folderId) {
    var out = [];
    var stack = [folderId];
    while (stack.length) {
      var cur = stack.pop();
      files.forEach(function (f) {
        if ((f.parentId || null) === cur) { out.push(f); if (f.kind === 'folder') stack.push(f.id); }
      });
    }
    return out;
  }

  function uniqueName(name, parentId) {
    var siblings = childrenOf(parentId).filter(function (f) { return !f.trashed; }).map(function (f) { return f.name; });
    if (siblings.indexOf(name) < 0) return name;
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var n = 1;
    var candidate = base + ' (' + n + ')' + ext;
    while (siblings.indexOf(candidate) >= 0) { n++; candidate = base + ' (' + n + ')' + ext; }
    return candidate;
  }

  function visibleFiles() {
    var list;
    if (state.view === 'trash') {
      list = files.filter(function (f) { return f.trashed; });
    } else if (state.view === 'all') {
      list = files.filter(function (f) { return !f.trashed && (f.parentId || null) === (state.folderId || null); });
    } else {
      list = files.filter(function (f) {
        if (f.trashed || f.kind === 'folder') return false;
        var k = kindOf(f);
        if (state.view === 'image') return k === 'image';
        if (state.view === 'video') return k === 'video';
        if (state.view === 'doc') return k === 'doc' || k === 'pdf';
        return true;
      });
    }
    if (state.query) {
      var q = state.query.toLowerCase();
      list = list.filter(function (f) { return f.name.toLowerCase().indexOf(q) >= 0; });
    }
    var parts = state.sort.split('-');
    var key = parts[0], dir = parts[1] === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      if (state.view === 'all') {
        var af = a.kind === 'folder' ? 0 : 1, bf = b.kind === 'folder' ? 0 : 1;
        if (af !== bf) return af - bf;
      }
      var r = 0;
      if (key === 'name') r = a.name.localeCompare(b.name, 'zh-Hans-CN');
      else if (key === 'size') r = (a.size || 0) - (b.size || 0);
      else r = (a.updatedAt || 0) - (b.updatedAt || 0);
      return r * dir;
    });
    return list;
  }

  /* ---------- toasts ---------- */
  function toast(msg, isErr) {
    var box = $('toasts');
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(function () { t.remove(); }, 260);
    }, 2200);
  }

  /* ---------- render ---------- */
  function render() {
    renderCrumb();
    renderList();
    renderCounts();
    renderQuota();
    $('newFolderBtn').style.display = state.view === 'all' ? '' : 'none';
  }

  function renderCrumb() {
    var el = $('crumb');
    el.innerHTML = '';
    if (state.view === 'trash') {
      el.innerHTML = '<span class="now">回收站</span>';
      return;
    }
    if (state.view !== 'all') {
      var label = { image: '图片', video: '视频', doc: '文档' }[state.view] || state.view;
      el.innerHTML = '<span class="now">' + label + '</span>';
      return;
    }
    var chain = [];
    var cur = state.folderId;
    while (cur) {
      var f = byId(cur);
      if (!f) break;
      chain.unshift(f);
      cur = f.parentId || null;
    }
    var rootBtn = document.createElement('button');
    rootBtn.textContent = '全部文件';
    rootBtn.addEventListener('click', function () { state.folderId = null; render(); });
    el.appendChild(rootBtn);
    chain.forEach(function (f, i) {
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.appendChild(iconEl('folder'));
      el.appendChild(sep);
      if (i === chain.length - 1) {
        var now = document.createElement('span');
        now.className = 'now';
        now.textContent = f.name;
        el.appendChild(now);
      } else {
        var b = document.createElement('button');
        b.textContent = f.name;
        b.addEventListener('click', function () { state.folderId = f.id; render(); });
        el.appendChild(b);
      }
    });
  }

  function renderList() {
    var wrap = $('items');
    var empty = $('empty');
    wrap.innerHTML = '';
    wrap.className = 'items' + (state.layout === 'grid' ? ' grid' : '');
    $('listHead').style.display = state.layout === 'grid' ? 'none' : '';

    var list = visibleFiles();
    if (!list.length) {
      wrap.classList.add('hidden');
      empty.classList.remove('hidden');
      if (state.view === 'trash') {
        $('emptyTitle').textContent = '回收站是空的';
        $('emptyDesc').textContent = '删除的文件会先放到这里，可随时还原。';
      } else if (state.query) {
        $('emptyTitle').textContent = '没有找到匹配的文件';
        $('emptyDesc').textContent = '换个关键词试试。';
      } else if (state.view !== 'all') {
        $('emptyTitle').textContent = '这个分类下还没有文件';
        $('emptyDesc').textContent = '上传后会自动归类到这里。';
      } else {
        $('emptyTitle').textContent = '这里还空着';
        $('emptyDesc').textContent = '把文件拖到这里，或点击「上传文件」开始。';
      }
      return;
    }
    wrap.classList.remove('hidden');
    empty.classList.add('hidden');
    list.forEach(function (f) { wrap.appendChild(rowEl(f)); });
  }

  function rowEl(f) {
    var kind = kindOf(f);
    var row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = f.id;

    var nameCell = document.createElement('div');
    nameCell.className = 'name-cell';
    var iconBox = document.createElement('div');
    iconBox.className = 'ficon k-' + kind;
    iconBox.appendChild(iconEl(kind));
    var wrap = document.createElement('div');
    wrap.className = 'name-wrap';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    name.title = f.name;
    name.addEventListener('click', function () { if (f.kind === 'folder') openFolder(f); else preview(f); });
    var sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = f.kind === 'folder' ? folderSub(f) : (extOf(f.name).toUpperCase() || '文件');
    wrap.appendChild(name);
    wrap.appendChild(sub);
    nameCell.appendChild(iconBox);
    nameCell.appendChild(wrap);

    var sizeCell = document.createElement('div');
    sizeCell.className = 'cell';
    sizeCell.textContent = f.kind === 'folder' ? folderSub(f) : formatBytes(f.size);

    var dateCell = document.createElement('div');
    dateCell.className = 'cell';
    dateCell.textContent = formatDate(state.view === 'trash' ? f.trashedAt : f.updatedAt);

    var actions = document.createElement('div');
    actions.className = 'row-actions';

    if (state.view === 'trash') {
      actions.appendChild(actBtn('#i-restore', '还原', function () { restore(f); }));
      actions.appendChild(actBtn('#i-trash', '彻底删除', function () { purge(f); }, true));
    } else {
      if (f.kind !== 'folder') actions.appendChild(actBtn('#i-download', '下载', function () { download(f); }));
      actions.appendChild(actBtn('#i-edit', '重命名', function () { rename(f); }));
      actions.appendChild(actBtn('#i-trash', '删除', function () { trash(f); }, true));
    }

    row.appendChild(nameCell);
    row.appendChild(sizeCell);
    row.appendChild(dateCell);
    row.appendChild(actions);
    row.addEventListener('click', function (e) {
      if (e.target.closest('.act')) return;
      document.querySelectorAll('.row.sel').forEach(function (r) { r.classList.remove('sel'); });
      row.classList.add('sel');
    });
    row.addEventListener('dblclick', function (e) {
      if (e.target.closest('.act')) return;
      if (f.kind === 'folder') openFolder(f); else preview(f);
    });
    return row;
  }

  function folderSub(f) {
    var n = childrenOf(f.id).filter(function (x) { return !x.trashed; }).length;
    return n + ' 项';
  }

  function actBtn(iconHref, title, handler, danger) {
    var b = document.createElement('button');
    b.className = 'act' + (danger ? ' del' : '');
    b.title = title;
    b.appendChild(svgUse(iconHref));
    b.addEventListener('click', function (e) { e.stopPropagation(); handler(); });
    return b;
  }

  function renderCounts() {
    var counts = { all: 0, image: 0, video: 0, doc: 0, trash: 0 };
    files.forEach(function (f) {
      if (f.trashed) { counts.trash++; return; }
      if (f.kind === 'folder') return;
      counts.all++;
      var k = kindOf(f);
      if (k === 'image') counts.image++;
      else if (k === 'video') counts.video++;
      else if (k === 'doc' || k === 'pdf') counts.doc++;
    });
    document.querySelectorAll('[data-count-for]').forEach(function (el) {
      var k = el.getAttribute('data-count-for');
      el.textContent = counts[k] ? counts[k] : '';
    });
  }

  function renderQuota() {
    var used = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);
    var pct = Math.min(100, (used / QUOTA) * 100);
    $('quotaText').textContent = formatBytes(used) + ' / 4 TB';
    $('quotaFill').style.width = Math.max(pct, used > 0 ? 0.6 : 0) + '%';
    $('quotaPct').textContent = '已使用 ' + (pct < 0.1 && used > 0 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)) + '%';
  }

  /* ---------- operations ---------- */
  function openFolder(f) {
    state.folderId = f.id;
    state.query = '';
    $('searchInput').value = '';
    render();
  }

  async function reload() {
    try {
      files = await dbGetAll();
    } catch (e) {
      toast('读取本地数据失败', true);
    }
  }

  async function trash(f) {
    var targets = [f].concat(f.kind === 'folder' ? descendantsOf(f.id) : []);
    var now = Date.now();
    targets.forEach(function (t) { t.trashed = true; t.trashedAt = now; });
    try {
      await dbPutMany(targets);
      await reload(); render();
      toast('已移到回收站：' + f.name);
    } catch (e) { toast('删除失败', true); }
  }

  async function restore(f) {
    var targets = [f].concat(f.kind === 'folder' ? descendantsOf(f.id) : []);
    targets.forEach(function (t) { t.trashed = false; t.trashedAt = null; t.updatedAt = Date.now(); });
    try {
      await dbPutMany(targets);
      await reload(); render();
      toast('已还原：' + f.name);
    } catch (e) { toast('还原失败', true); }
  }

  async function purge(f) {
    var targets = [f].concat(f.kind === 'folder' ? descendantsOf(f.id) : []);
    var ok = await confirmModal('彻底删除', '「' + f.name + '」及其内容将被永久删除，无法恢复。', '永久删除', true);
    if (!ok) return;
    try {
      await dbDelete(targets.map(function (t) { return t.id; }));
      await reload(); render();
      toast('已永久删除');
    } catch (e) { toast('删除失败', true); }
  }

  function rename(f) {
    openPrompt('重命名', '为「' + f.name + '」输入新名称', f.name, function (val) {
      val = val.trim();
      if (!val) return;
      if (val === f.name) return;
      f.name = uniqueName(val, f.parentId || null);
      f.updatedAt = Date.now();
      dbPut(f).then(function () { reload(); render(); }).catch(function () { toast('重命名失败', true); });
    });
  }

  function download(f) {
    if (!f.blob) { toast('文件内容已丢失', true); return; }
    var url = URL.createObjectURL(f.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('开始下载：' + f.name);
  }

  /* ---------- preview ---------- */
  var previewUrl = null;
  var lastPreviewFile = null;

  function preview(f) {
    lastPreviewFile = f;
    var kind = kindOf(f);
    var box = $('modalBox');
    box.className = 'modal-box preview-box';
    box.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'pv-head';
    var t = document.createElement('b');
    t.textContent = f.name;
    var size = document.createElement('span');
    size.className = 'pv-size';
    size.textContent = formatBytes(f.size);
    var close = document.createElement('button');
    close.className = 'icon-btn';
    close.appendChild(svgUse('#i-close'));
    close.addEventListener('click', closeModal);
    head.appendChild(t); head.appendChild(size); head.appendChild(close);

    var body = document.createElement('div');
    body.className = 'pv-body';

    if (!f.blob) {
      body.appendChild(nonePreview(kind, '文件内容不可用'));
    } else if (kind === 'image') {
      previewUrl = URL.createObjectURL(f.blob);
      var img = document.createElement('img');
      img.src = previewUrl;
      img.alt = f.name;
      body.appendChild(img);
    } else if (kind === 'video') {
      previewUrl = URL.createObjectURL(f.blob);
      var v = document.createElement('video');
      v.src = previewUrl;
      v.controls = true;
      v.autoplay = true;
      body.appendChild(v);
    } else if (kind === 'audio') {
      previewUrl = URL.createObjectURL(f.blob);
      var au = document.createElement('audio');
      au.src = previewUrl;
      au.controls = true;
      au.autoplay = true;
      body.appendChild(au);
    } else if (kind === 'pdf') {
      previewUrl = URL.createObjectURL(f.blob);
      var ifr = document.createElement('iframe');
      ifr.src = previewUrl;
      ifr.title = f.name;
      body.appendChild(ifr);
    } else if (kind === 'doc' && (f.mime.indexOf('text/') === 0 || ['txt', 'md', 'csv', 'json'].indexOf(extOf(f.name)) >= 0) && f.size < 512 * 1024) {
      var pre = document.createElement('pre');
      pre.textContent = '正在读取…';
      body.appendChild(pre);
      f.blob.text().then(function (txt) { pre.textContent = txt || '(空文件)'; })
        .catch(function () { pre.textContent = '无法读取文本内容'; });
    } else {
      body.appendChild(nonePreview(kind, '此类型暂不支持在线预览'));
    }

    box.appendChild(head);
    box.appendChild(body);
    $('modal').classList.remove('hidden');
  }

  function nonePreview(kind, msg) {
    var d = document.createElement('div');
    d.className = 'pv-none';
    var ic = document.createElement('div');
    ic.className = 'ficon k-' + kind;
    ic.appendChild(iconEl(kind));
    var p = document.createElement('p');
    p.textContent = msg + '，请下载后查看。';
    d.appendChild(ic);
    d.appendChild(p);
    var btn = document.createElement('button');
    btn.className = 'btn soft';
    btn.textContent = '下载文件';
    btn.addEventListener('click', function () {
      if (lastPreviewFile) download(lastPreviewFile);
    });
    d.appendChild(btn);
    return d;
  }

  function closeModal() {
    $('modal').classList.add('hidden');
    $('modalBox').className = 'modal-box';
    $('modalBox').innerHTML = '';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    lastPreviewFile = null;
  }

  /* ---------- modal utilities ---------- */
  function openPrompt(title, desc, value, onSubmit) {
    var box = $('modalBox');
    box.className = 'modal-box';
    box.innerHTML = '';
    var h = document.createElement('h3'); h.textContent = title;
    var p = document.createElement('p'); p.className = 'm-desc'; p.textContent = desc;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    var actions = document.createElement('div'); actions.className = 'm-actions';
    var cancel = document.createElement('button'); cancel.className = 'btn soft'; cancel.textContent = '取消';
    var ok = document.createElement('button'); ok.className = 'btn solid'; ok.textContent = '确定';
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', function () {
      var v = input.value;
      closeModal();
      onSubmit(v);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
    });
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(h); box.appendChild(p); box.appendChild(input); box.appendChild(actions);
    $('modal').classList.remove('hidden');
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  function confirmModal(title, desc, okText, danger) {
    return new Promise(function (resolve) {
      var box = $('modalBox');
      box.className = 'modal-box';
      box.innerHTML = '';
      var h = document.createElement('h3'); h.textContent = title;
      var p = document.createElement('p'); p.className = 'm-desc'; p.textContent = desc;
      var actions = document.createElement('div'); actions.className = 'm-actions';
      var cancel = document.createElement('button'); cancel.className = 'btn soft'; cancel.textContent = '取消';
      var ok = document.createElement('button'); ok.className = 'btn ' + (danger ? 'danger' : 'solid'); ok.textContent = okText || '确定';
      cancel.addEventListener('click', function () { closeModal(); resolve(false); });
      ok.addEventListener('click', function () { closeModal(); resolve(true); });
      actions.appendChild(cancel); actions.appendChild(ok);
      box.appendChild(h); box.appendChild(p); box.appendChild(actions);
      $('modal').classList.remove('hidden');
    });
  }

  /* ---------- folder create ---------- */
  function newFolder() {
    var parentId = state.view === 'all' ? state.folderId : null;
    openPrompt('新建文件夹', '在当前目录下创建一个新文件夹', '未命名文件夹', function (val) {
      val = val.trim();
      if (!val) return;
      var rec = {
        id: uid(), name: uniqueName(val, parentId), kind: 'folder',
        mime: '', size: 0, parentId: parentId, blob: null,
        createdAt: Date.now(), updatedAt: Date.now(), trashed: false, trashedAt: null
      };
      dbPut(rec).then(function () { reload(); render(); toast('已创建文件夹'); })
        .catch(function () { toast('创建失败', true); });
    });
  }

  /* ---------- uploads ---------- */
  function handleFiles(list) {
    if (!list || !list.length) return;
    var arr = Array.prototype.slice.call(list);
    var parentId = state.view === 'all' ? state.folderId : null;
    var panel = $('progressPanel');
    var plist = $('progressList');
    panel.classList.remove('hidden');

    var done = 0;
    arr.forEach(function (file, idx) {
      var item = document.createElement('div');
      item.className = 'pp-item';
      var top = document.createElement('div');
      top.className = 'pp-top';
      var nm = document.createElement('span'); nm.textContent = file.name;
      var st = document.createElement('em'); st.textContent = '准备中';
      top.appendChild(nm); top.appendChild(st);
      var bar = document.createElement('div'); bar.className = 'pp-bar';
      var fill = document.createElement('i');
      bar.appendChild(fill);
      item.appendChild(top); item.appendChild(bar);
      plist.appendChild(item);

      var pct = 0;
      var timer = setInterval(function () {
        pct = Math.min(92, pct + 12 + Math.random() * 22);
        fill.style.width = pct + '%';
        st.textContent = Math.round(pct) + '%';
      }, 120);

      var rec = {
        id: uid(),
        name: uniqueName(file.name, parentId),
        kind: 'file',
        mime: file.type || 'application/octet-stream',
        size: file.size,
        parentId: parentId,
        blob: file,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        trashed: false,
        trashedAt: null
      };

      setTimeout(function () {
        dbPut(rec).then(function () {
          clearInterval(timer);
          fill.style.width = '100%';
          st.textContent = '已完成';
          item.classList.add('done');
          done++;
          reload().then(render);
          if (done === arr.length) toast('已上传 ' + arr.length + ' 个文件');
        }).catch(function () {
          clearInterval(timer);
          st.textContent = '失败';
          item.style.opacity = '.6';
          toast('「' + file.name + '」上传失败', true);
        });
      }, 350 + idx * 120);
    });
  }

  /* ---------- login ---------- */
  function enterApp(name) {
    state.user = name;
    localStorage.setItem('nebula.user', name);
    $('userName').textContent = name;
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    reload().then(render);
  }

  /* ---------- init ---------- */
  async function init() {
    try {
      db = await openDB();
    } catch (e) {
      toast('无法初始化本地存储，请更换浏览器或关闭无痕模式', true);
    }
    var saved = localStorage.getItem('nebula.user');
    if (saved) enterApp(saved);

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('nickname').value.trim();
      if (!v) return;
      enterApp(v);
    });

    $('logoutBtn').addEventListener('click', function () {
      localStorage.removeItem('nebula.user');
      state.user = '';
      $('app').classList.add('hidden');
      $('login').classList.remove('hidden');
      $('nickname').value = '';
      setTimeout(function () { $('nickname').focus(); }, 40);
    });

    $('uploadBtn').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
      e.target.value = '';
    });

    $('newFolderBtn').addEventListener('click', newFolder);

    $('searchInput').addEventListener('input', function (e) {
      state.query = e.target.value.trim();
      renderList();
    });

    $('sortSelect').addEventListener('change', function (e) {
      state.sort = e.target.value;
      renderList();
    });

    document.querySelectorAll('#viewSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#viewSeg button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.layout = b.getAttribute('data-view');
        renderList();
      });
    });

    document.querySelectorAll('#sideNav a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.querySelectorAll('#sideNav a').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
        state.view = a.getAttribute('data-view');
        state.folderId = null;
        state.query = '';
        $('searchInput').value = '';
        render();
      });
    });

    $('backHome').href = HOME_URL;

    $('progressClear').addEventListener('click', function () {
      $('progressList').innerHTML = '';
      $('progressPanel').classList.add('hidden');
    });

    $('modal').addEventListener('mousedown', function (e) {
      if (e.target === $('modal')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal();
    });

    /* drag & drop */
    var content = $('content');
    var overlay = $('dropOverlay');
    var dragDepth = 0;
    ['dragenter', 'dragover'].forEach(function (ev) {
      content.addEventListener(ev, function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) {
          overlay.classList.remove('hidden');
        }
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      content.addEventListener(ev, function (e) {
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (e.target === content || !e.relatedTarget) overlay.classList.add('hidden');
      });
    });
    content.addEventListener('drop', function (e) {
      e.preventDefault();
      overlay.classList.add('hidden');
      if (state.view !== 'all') {
        toast('请切换到「全部文件」后再拖入上传');
        return;
      }
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
