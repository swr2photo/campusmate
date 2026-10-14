//! In-memory discovery index kept current by Firestore listeners.
//!
//! Every request is answered from memory, so a discovery page costs one
//! Firestore read (the caller's entitlement) instead of ~9 reads per
//! candidate. Listener deltas typically land within a second; blocks and
//! decisions therefore take effect about as fast as the old callable saw them.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use firestore::*;
use parking_lot::RwLock;
use serde_json::{Map, Value};

use crate::model::{Decision, UserRecord};
use crate::value::{document_path, fields_to_json, js_str};

#[derive(Default)]
pub struct PoolData {
    pub users: HashMap<String, Arc<UserRecord>>,
    /// `discoveryProfiles/{uid}`: the allowlisted public projection we return.
    pub public: HashMap<String, Arc<Map<String, Value>>>,
    /// `profileVisibility/{uid}.mode` (`"invalid"` when the doc lacks a mode).
    pub visibility: HashMap<String, String>,
    pub entitlements: HashMap<String, Value>,
    decision_docs: HashMap<String, Decision>,
    /// from -> to -> decision
    pub outgoing: HashMap<String, HashMap<String, Decision>>,
    /// to -> from -> decision
    pub incoming: HashMap<String, HashMap<String, Decision>>,
    /// owner -> users the owner blocked
    pub blocks: HashMap<String, HashSet<String>>,
    /// target -> owners who blocked the target
    pub blocked_by: HashMap<String, HashSet<String>>,
    conversation_docs: HashMap<String, Vec<String>>,
    /// user -> users sharing a conversation
    pub partners: HashMap<String, HashSet<String>>,
}

fn link(index: &mut HashMap<String, HashSet<String>>, key: &str, value: &str) {
    index.entry(key.to_owned()).or_default().insert(value.to_owned());
}
fn unlink(index: &mut HashMap<String, HashSet<String>>, key: &str, value: &str) {
    if let Some(set) = index.get_mut(key) {
        set.remove(value);
        if set.is_empty() {
            index.remove(key);
        }
    }
}

impl PoolData {
    fn put_decision(&mut self, doc_id: &str, decision: Option<Decision>) {
        if let Some(old) = self.decision_docs.remove(doc_id) {
            if let Some(map) = self.outgoing.get_mut(&old.from) { map.remove(&old.to); }
            if let Some(map) = self.incoming.get_mut(&old.to) { map.remove(&old.from); }
        }
        if let Some(decision) = decision {
            self.outgoing.entry(decision.from.clone()).or_default().insert(decision.to.clone(), decision.clone());
            self.incoming.entry(decision.to.clone()).or_default().insert(decision.from.clone(), decision.clone());
            self.decision_docs.insert(doc_id.to_owned(), decision);
        }
    }

    fn put_conversation(&mut self, doc_id: &str, participants: Option<Vec<String>>) {
        if let Some(old) = self.conversation_docs.remove(doc_id) {
            if let [a, b] = old.as_slice() {
                unlink(&mut self.partners, a, b);
                unlink(&mut self.partners, b, a);
            }
        }
        if let Some(participants) = participants.filter(|p| p.len() == 2 && p[0] != p[1]) {
            link(&mut self.partners, &participants[0], &participants[1]);
            link(&mut self.partners, &participants[1], &participants[0]);
            self.conversation_docs.insert(doc_id.to_owned(), participants);
        }
    }

    /// Apply one document change; `fields` is `None` for deletes/removals.
    pub fn apply(&mut self, path: &[&str], fields: Option<Map<String, Value>>) {
        match path {
            ["users", uid] => match fields {
                Some(fields) => { self.users.insert((*uid).to_owned(), Arc::new(UserRecord::from_fields(fields))); }
                None => { self.users.remove(*uid); }
            },
            ["discoveryProfiles", uid] => match fields {
                Some(fields) => { self.public.insert((*uid).to_owned(), Arc::new(fields)); }
                None => { self.public.remove(*uid); }
            },
            ["profileVisibility", uid] => match fields {
                Some(fields) => {
                    let mode = js_str(&fields, "mode");
                    self.visibility.insert((*uid).to_owned(), if mode.is_empty() { "invalid".into() } else { mode.into() });
                }
                None => { self.visibility.remove(*uid); }
            },
            ["entitlements", uid] => match fields {
                Some(fields) => { self.entitlements.insert((*uid).to_owned(), Value::Object(fields)); }
                None => { self.entitlements.remove(*uid); }
            },
            ["decisions", doc_id] => {
                let decision = fields.as_ref().and_then(Decision::from_fields);
                self.put_decision(doc_id, decision);
            }
            ["users", owner, "blockedUsers", target] => {
                if fields.is_some() {
                    link(&mut self.blocks, owner, target);
                    link(&mut self.blocked_by, target, owner);
                } else {
                    unlink(&mut self.blocks, owner, target);
                    unlink(&mut self.blocked_by, target, owner);
                }
            }
            ["conversations", doc_id] => {
                let participants = fields.as_ref().and_then(|f| f.get("participants")).and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect());
                self.put_conversation(doc_id, participants);
            }
            _ => {}
        }
    }
}

/// Listener targets. Each must report CURRENT before the pool serves traffic.
const TARGETS: [(u32, &str, bool); 7] = [
    (1, "users", false),
    (2, "discoveryProfiles", false),
    (3, "profileVisibility", false),
    (4, "entitlements", false),
    (5, "decisions", false),
    (6, "blockedUsers", true),
    (7, "conversations", false),
];
const ALL_READY: u32 = (1 << TARGETS.len()) - 1;

#[derive(Default)]
pub struct Pool {
    pub data: RwLock<PoolData>,
    ready_mask: AtomicU32,
}

impl Pool {
    pub fn is_ready(&self) -> bool {
        self.ready_mask.load(Ordering::Acquire) == ALL_READY
    }

    fn mark_current(&self, target_ids: &[i32]) {
        let mask = if target_ids.is_empty() {
            ALL_READY
        } else {
            target_ids.iter().filter(|id| (1..=TARGETS.len() as i32).contains(id)).fold(0, |mask, id| mask | 1 << (id - 1))
        };
        let before = self.ready_mask.fetch_or(mask, Ordering::AcqRel);
        if before != ALL_READY && (before | mask) == ALL_READY {
            let data = self.data.read();
            tracing::info!(users = data.users.len(), discoverable = data.public.len(), decisions = data.decision_docs.len(), "discovery pool ready");
        }
    }
}

/// Runs the listener forever, restarting with backoff if it stops.
pub fn spawn_sync(db: FirestoreDb, pool: Arc<Pool>) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(1);
        loop {
            match run_listener(&db, pool.clone()).await {
                Ok(()) => tracing::warn!("firestore listener stopped; restarting"),
                Err(error) => tracing::error!(%error, "firestore listener failed; restarting"),
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(60));
        }
    });
}

async fn run_listener(db: &FirestoreDb, pool: Arc<Pool>) -> anyhow::Result<()> {
    let mut listener = db.create_listener(FirestoreMemListenStateStorage::new()).await?;
    for (id, collection, group) in TARGETS {
        let query = db.fluent().select().from(collection);
        let query = if group { query.all_descendants() } else { query };
        query.listen().add_target(FirestoreListenerTarget::new(id), &mut listener)?;
    }
    let handler_pool = pool.clone();
    listener
        .start(move |event| {
            let pool = handler_pool.clone();
            async move {
                match event {
                    FirestoreListenEvent::DocumentChange(change) => {
                        if let Some(document) = change.document {
                            let path = document_path(&document.name).into_iter().map(str::to_owned).collect::<Vec<_>>();
                            let path: Vec<&str> = path.iter().map(String::as_str).collect();
                            pool.data.write().apply(&path, Some(fields_to_json(&document)));
                        }
                    }
                    FirestoreListenEvent::DocumentDelete(deleted) => {
                        pool.data.write().apply(&document_path(&deleted.document), None);
                    }
                    FirestoreListenEvent::DocumentRemove(removed) => {
                        pool.data.write().apply(&document_path(&removed.document), None);
                    }
                    FirestoreListenEvent::TargetChange(change) => {
                        // TargetChangeType::Current == 3
                        if change.target_change_type == 3 {
                            pool.mark_current(&change.target_ids);
                        }
                    }
                    _ => {}
                }
                Ok(())
            }
        })
        .await?;
    // Keep this task alive while the listener runs in the background.
    std::future::pending::<()>().await;
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields(value: Value) -> Option<Map<String, Value>> {
        value.as_object().cloned()
    }

    #[test]
    fn indexes_follow_updates_and_deletes() {
        let mut data = PoolData::default();
        data.apply(&["decisions", "a_b"], fields(json!({ "fromUserId": "a", "toUserId": "b", "type": "like", "status": "pending" })));
        assert_eq!(data.outgoing["a"]["b"].status, "pending");
        data.apply(&["decisions", "a_b"], fields(json!({ "fromUserId": "a", "toUserId": "b", "type": "like", "status": "accepted" })));
        assert_eq!(data.incoming["b"]["a"].status, "accepted");
        data.apply(&["decisions", "a_b"], None);
        assert!(data.outgoing.get("a").is_none_or(|m| m.is_empty()));

        data.apply(&["users", "a", "blockedUsers", "c"], fields(json!({ "targetUserId": "c" })));
        assert!(data.blocked_by["c"].contains("a"));
        data.apply(&["users", "a", "blockedUsers", "c"], None);
        assert!(!data.blocked_by.contains_key("c"));

        data.apply(&["conversations", "c-a-d"], fields(json!({ "participants": ["a", "d"] })));
        assert!(data.partners["d"].contains("a"));
        data.apply(&["profileVisibility", "a"], fields(json!({})));
        assert_eq!(data.visibility["a"], "invalid");
    }
}
