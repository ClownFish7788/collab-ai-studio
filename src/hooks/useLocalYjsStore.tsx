import { useEffect, useMemo, useState } from "react";
import { YKeyValue } from "y-utility/y-keyvalue";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import * as Y from "yjs";
import { createTLStore, transact, defaultShapeUtils, TLRecord, TLStoreWithStatus } from "tldraw";

export function useLocalYjsStore(yDoc: Y.Doc, roomId: string) {
  const { yStore, indexDbProvider } = useMemo(() => {
    // 绑定本地数据库
    const indexDbProvider = new IndexeddbPersistence(`room-${roomId}`, yDoc);
    const yArr = yDoc.getArray<{ key: string; val: TLRecord }>("tl_records");
    const yStore = new YKeyValue(yArr);
    return { yStore, indexDbProvider };
  }, [roomId, yDoc]);

  const [store] = useState(() => createTLStore({ shapeUtils: [...defaultShapeUtils] }));
  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({ status: "loading" });

  useEffect(() => {
    setStoreWithStatus({ status: "loading" });
    const unsubs: (() => void)[] = [];

    function handleSync() {
      // 1. 初始化时，将 Yjs 数据载入 Tldraw
      if (yStore.yarray.length) {
        transact(() => {
          const toRemove = store.allRecords()
            .filter(r => ['shape', 'page', 'document', 'asset', 'binding'].includes(r.typeName))
            .map(r => r.id);
          if (toRemove.length > 0) store.remove(toRemove);
          const records = yStore.yarray.toJSON().map(({ val }: any) => val);
          store.put(records);
        });
      } else {
        yDoc.transact(() => {
          for (const record of store.allRecords()) {
            if (['shape', 'page', 'document', 'asset', 'binding'].includes(record.typeName)) {
              yStore.set(record.id, record);
            }
          }
        });
      }

      // 2. 监听 Yjs 的变化，同步到 Tldraw（解决跨标签页/远端同步）
      const handleChange = (changes: any, transaction: Y.Transaction) => {
        if (transaction.local) return;
        const toRemove: TLRecord["id"][] = [];
        const toPut: TLRecord[] = [];
        
        changes.forEach((change: any, id: string) => {
          switch (change.action) {
            case "add":
            case "update": {
                const record = yStore.get(id);
                if (!record) break;
                if (['shape', 'page', 'document', 'asset', 'binding'].includes(record.typeName)) {
                    toPut.push(record as TLRecord);
                }
                break;
            }
            case "delete": {
                if (id.startsWith('shape:') || id.startsWith('page:') || id.startsWith('asset:') || id.startsWith('binding:')) {
                    toRemove.push(id as TLRecord["id"]);
                }
                break;
            }
          }
        });
        store.mergeRemoteChanges(() => {
          if (toRemove.length) store.remove(toRemove);
          if (toPut.length) store.put(toPut);
        });
      };

      yStore.on("change", handleChange);
      unsubs.push(() => yStore.off("change", handleChange));

      // 🌟🌟 3. 【核心修复】监听 Tldraw 的变化，写回 Yjs 和本地数据库
      unsubs.push(
        store.listen(
          ({ changes }) => {
            yDoc.transact(() => {
              Object.values(changes.added).forEach((record) => {
                yStore.set(record.id, record);
              });
              Object.values(changes.updated).forEach(([_, record]) => {
                yStore.set(record.id, record);
              });
              Object.values(changes.removed).forEach((record) => {
                yStore.delete(record.id);
              });
            });
          },
          { source: 'user', scope: 'document' } // 必须指定 source: 'user'，防止死循环
        )
      );

      setStoreWithStatus({ store, status: "synced-remote", connectionStatus: "online" });
    }

    if (indexDbProvider.synced) {
      handleSync();
    } else {
      const syncedHandler = () => handleSync();
      indexDbProvider.on("synced", syncedHandler);
      unsubs.push(() => indexDbProvider.off("synced", syncedHandler));
    }

    const handleBeforeUnload = () => {
      if (!indexDbProvider._destroyed) {
        storeState(indexDbProvider);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    unsubs.push(() => window.removeEventListener("beforeunload", handleBeforeUnload));

    return () => unsubs.forEach((fn) => fn());
  }, [yDoc, store, yStore, indexDbProvider]);

  return storeWithStatus;
}