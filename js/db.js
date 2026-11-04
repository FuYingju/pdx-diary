/**
 * 本地数据存储层
 * 负责把血压、体重、腹透超滤、用药、记事等记录，保存到手机浏览器自带的 IndexedDB 中。
 * 所有数据只存在本机，不联网、不上传。
 */

(() => {
  const DATE_KEY = 'by_date';

  // 创建一套 IndexedDB 操作接口；库不存在时按 init 建表
  function createStore(name, init) {
    let _dbPromise = null;

    function open() {
      return new Promise((resolve, reject) => {
        // 不指定版本号：库已存在时直接打开，不触发升级，避免被旧页面的连接阻塞
        const req = indexedDB.open(name);
        req.onupgradeneeded = () => init(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    // 连接只打开一次，并发调用共用同一个 Promise
    const conn = () => (_dbPromise || (_dbPromise = open()));

    // 写入一条记录
    async function add(store, obj) {
      const db = await conn();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).add(obj);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    // 按 id 删除一条记录
    async function remove(store, id) {
      const db = await conn();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    // 按 id 更新一条记录（对象必须带 id 字段，其余字段整体覆盖）
    async function update(store, obj) {
      const db = await conn();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(obj);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    // 读取某个表的全部记录（按 id 升序）
    async function getAll(store) {
      const db = await conn();
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    // 读取某一天（date）的记录
    async function getByDate(store, date) {
      const db = await conn();
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly')
          .objectStore(store).index(DATE_KEY).getAll(date);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    return { add, update, remove, getAll, getByDate };
  }

  // 健康记录与用药：沿用原库，老数据保持不动
  window.DB = createStore('pdx_diary', (db) => {
    ['bp', 'weight', 'pd'].forEach((name) => {
      const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
      store.createIndex(DATE_KEY, 'date', { unique: false });
    });
    db.createObjectStore('meds', { keyPath: 'id', autoIncrement: true });
  });

  // 记事本：独立库，不牵动主库
  window.NoteDB = createStore('pdx_diary_notes', (db) => {
    db.createObjectStore('noteCats', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
  });
})();
