import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoom } from "@liveblocks/react";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { YKeyValue } from "y-utility/y-keyvalue";
import { IndexeddbPersistence, storeState } from "y-indexeddb"; // 引入本地持久化
import * as Y from "yjs";
import {
  computed,
  createPresenceStateDerivation,
  createTLStore,
  transact,
  react,
  defaultShapeUtils,
  InstancePresenceRecordType,
  TLAnyShapeUtilConstructor,
  TLInstancePresence,
  TLRecord,
  TLStoreWithStatus,
} from "tldraw";
import { throttle } from "@/utils/throttle";
import useNetworkStore from "@/app/store/useNetworkStore";
import CustomBoradcastChannel from "@/utils/BoradcastChannelProvider";
import toggleRealtimeEditing from "@/utils/toggleRealtimeEditing";

export function useYjsStore(yDoc: Y.Doc, yProvider: LiveblocksYjsProvider, {
  shapeUtils = [],
  user
}: Partial<{
  hostUrl: string;
  version: number;
  shapeUtils: TLAnyShapeUtilConstructor[];
  user: {
    id: string;
    color: string;
    name: string;
  };
}>) {
  const room = useRoom();
  const { yStore, indexDbProvider } = useMemo(() => {
    // 1. 【核心更改】为当前的 yDoc 绑定 IndexedDB 本地持久化
    // 使用 room.id 作为数据库名称，确保不同房间的数据在本地隔离
    const indexDbProvider = new IndexeddbPersistence(`room-${room.id}`, yDoc);

    const yArr = yDoc.getArray<{ key: string; val: TLRecord }>("tl_records");
    const yStore = new YKeyValue(yArr);

    return { yStore, indexDbProvider };
  }, [room, yDoc]);
  
  const customProvider = useRef<CustomBoradcastChannel | null>(null)
  const isOpenNetwork = useNetworkStore(state => state.isOpenNetwork)
  const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)

  useEffect(() => {
    toggleRealtimeEditing(yProvider, !isOpenNetwork, customProvider.current)
    customProvider.current = null
    if(isOpenNetwork && user) {
      customProvider.current = new CustomBoradcastChannel(user?.id, yDoc)
    }
    return () => {
      if(customProvider.current) {
        customProvider.current.destroy()
      }
    }
  }, [isOpenNetwork, yProvider, toggleNetworkStatus, yDoc, user])

  const [store] = useState(() => {
    return createTLStore({ shapeUtils: [...defaultShapeUtils, ...shapeUtils] });
  });

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  });

  const localStateField = useCallback(() => {
    throttle(() => {
      yProvider.awareness.setLocalStateField("presence", null)
    }, 50)
  }, [yProvider])

  useEffect(() => {
    setStoreWithStatus({ status: "loading" });
    const unsubs: (() => void)[] = [];

    // 这个函数只会在本地 IndexedDB 加载完毕后执行
    function handleSync() {
      // 如果 Yjs 里面有数据（从本地缓存或云端拉取的）
      if (yStore.yarray.length) {
        transact(() => {
          const toRemove = store.allRecords()
            .filter(record => 
               record.typeName === 'shape' ||
               record.typeName === 'page' ||
               record.typeName === 'document' ||
               record.typeName === 'asset' ||
               record.typeName === 'binding'
            )
            .map(record => record.id);
          if(toRemove.length > 0) {
            store.remove(toRemove)
          }
          const records = yStore.yarray.toJSON().map(({ val }) => val);
          store.put(records);
        });
      } else {
        // 如果是全新的一张白板（本地没数据，云端也没数据）
        yDoc.transact(() => {
          for (const record of store.allRecords()) {
            if (
               record.typeName === 'shape' ||
               record.typeName === 'page' ||
               record.typeName === 'document' ||
               record.typeName === 'asset' ||
               record.typeName === 'binding'
            ) {
               yStore.set(record.id, record);
            }
          }
        });
      }

      // ==== 监听 Yjs 变动（来自 Liveblocks 别人画的） -> 渲染到 tldraw ====
      const handleChange = (changes: any, transaction: Y.Transaction) => {
        if (transaction.local) return;
        const toRemove: TLRecord["id"][] = [];
        const toPut: TLRecord[] = [];
        // 解析 Y.js 数据给 tlDraw
        changes.forEach((change: any, id: string) => {
          switch (change.action) {
            case "add":
            case "update": {
                const record = yStore.get(id);
                if (!record) break;
                
                // 【关键修改 2】：只允许文档级别的数据更新本地 store
                if (
                    record.typeName === 'shape' ||
                    record.typeName === 'page' ||
                    record.typeName === 'document' ||
                    record.typeName === 'asset' ||
                    record.typeName === 'binding'
                ) {
                    toPut.push(record as TLRecord);
                }
                break;
                }
            case "delete": {
                // 也要注意，如果是删除操作，确保它不是意外删除了你本地的 camera
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

      // ==== 解决 TypeScript 报错的光标 (Presence) 逻辑 ====
      const userPreferences = computed("userPreferences", () => {
        if (!user) throw new Error("Failed to get user");
        return { id: user.id, color: user.color, name: user.name };
      });

      const self = room.getSelf();
      const yClientId = (self?.presence as any)?.__yjs_clientid;
      const presenceId = InstancePresenceRecordType.createId(
        yProvider.awareness.doc.clientID.toString()
      );

      const presenceDerivation = createPresenceStateDerivation(userPreferences, presenceId)(store);

      // 2. 【核心更改】使用 `as any` 解决类型校验冲突，运行时完全正常
      yProvider.awareness.setLocalStateField(
        "presence",
        (presenceDerivation.get() as any) ?? null
      );

      unsubs.push(
        react("when presence changes", () => {
          const presence = presenceDerivation.get() ?? null;

          if(!presence) {
            localStateField()
          }
          let safePresence = presence
          // 在选中大量元素进行拖拽时，通过拦截 presence 的选中id传送，以达到其他用户无法感知的目的
          if(safePresence?.selectedShapeIds && safePresence.selectedShapeIds.length > 10) {
            safePresence = {
              ...presence,
              selectedShapeIds: []
            } as TLInstancePresence
          }
          throttle(() => {
            yProvider.awareness.setLocalStateField("presence", safePresence as any);
          }, 50)
        })
      );

      const handleUpdate = (update: { added: number[]; updated: number[]; removed: number[] }) => {
        const states = yProvider.awareness.getStates() as Map<number, { presence: TLInstancePresence }>;
        const toRemove: TLInstancePresence["id"][] = [];
        const toPut: TLInstancePresence[] = [];

        for (const clientId of [...update.added, ...update.updated]) {
          const state = states.get(clientId);
          if (state?.presence && state.presence.id !== presenceId) {
            toPut.push(state.presence);
          }
        }

        for (const clientId of update.removed) {
          toRemove.push(InstancePresenceRecordType.createId(clientId.toString()));
        }

        store.mergeRemoteChanges(() => {
          if (toRemove.length > 0) store.remove(toRemove);
          if (toPut.length > 0) store.put(toPut);
        });
      };

      yProvider.awareness.on("change", handleUpdate);
      unsubs.push(() => yProvider.awareness.off("change", handleUpdate));

      // 标记为同步完成，可以开始渲染组件
      setStoreWithStatus({ store, status: "synced-remote", connectionStatus: "online" });
    }

    // 3. 【核心更改】等待本地 IndexedDB 加载完毕后，再初始化 tldraw！
    // 这样能确保离线状态下，打开页面立刻能看到之前画的内容。
    // 处理 React 重挂载或 Strict Mode：若已 synced 则直接执行，否则监听
    const syncedHandler = () => handleSync();
    if (indexDbProvider.synced) {
      handleSync();
    } else {
      indexDbProvider.on("synced", syncedHandler);
      unsubs.push(() => indexDbProvider.off("synced", syncedHandler));
    }

    // 4. 刷新/关闭页面前强制 flush 到 IndexedDB，避免异步写入未完成导致数据丢失
    const handleBeforeUnload = () => {
      if (!indexDbProvider._destroyed) {
        storeState(indexDbProvider);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload);
      unsubs.push(() => window.removeEventListener("beforeunload", handleBeforeUnload));
    }

    return () => {
      unsubs.forEach((fn) => fn());
      unsubs.length = 0;
    };
  }, [yProvider, yDoc, store, yStore, indexDbProvider, room, user, localStateField]);

  return storeWithStatus;
}