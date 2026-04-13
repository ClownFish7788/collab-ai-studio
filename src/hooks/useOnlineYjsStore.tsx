import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoom } from "@liveblocks/react";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { YKeyValue } from "y-utility/y-keyvalue";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
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

export function useOnlineYjsStore(yDoc: Y.Doc, yProvider: LiveblocksYjsProvider, {
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

    function handleSync() {
      // 初始化数据装载
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

      // 监听 Yjs 变动（来自别人广播或本地IndexedDB） -> 渲染到 tldraw
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

      // 🌟🌟 【核心修复】监听 Tldraw 本地绘画动作 -> 广播给 Yjs / Liveblocks / IndexedDB
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
          { source: 'user', scope: 'document' }
        )
      );

      // ==== 光标 (Presence) 逻辑 ====
      const userPreferences = computed("userPreferences", () => {
        if (!user) throw new Error("Failed to get user");
        return { id: user.id, color: user.color, name: user.name };
      });

      const self = room.getSelf();
      const presenceId = InstancePresenceRecordType.createId(
        yProvider.awareness.doc.clientID.toString()
      );

      const presenceDerivation = createPresenceStateDerivation(userPreferences, presenceId)(store);

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