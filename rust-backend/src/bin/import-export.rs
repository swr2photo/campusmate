//! Offline staging import. No Firebase SDK, network export, or public activation.
use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const PROJECT: &str = "campusmate-7f1ab";
const NAMES: [&str; 3] = [
    "auth-users.jsonl",
    "firestore.jsonl",
    "storage-objects.jsonl",
];
#[derive(Deserialize)]
struct Manifest {
    format_version: u32,
    project_id: String,
    completed: bool,
    password_credentials_exported: bool,
    files: Vec<ExportFile>,
}
#[derive(Deserialize)]
struct ExportFile {
    name: String,
    rows: u64,
    bytes: u64,
    sha256: String,
}
struct Snapshot {
    directory: PathBuf,
    manifest: Manifest,
}

fn regular_file(path: &Path) -> Result<fs::File> {
    let meta = fs::symlink_metadata(path).context("missing export file")?;
    ensure!(
        meta.is_file() && !meta.file_type().is_symlink(),
        "export must contain regular files"
    );
    fs::File::open(path).context("cannot open export file")
}
fn each_row(path: &Path, mut consume: impl FnMut(Value) -> Result<()>) -> Result<u64> {
    let mut reader = BufReader::new(regular_file(path)?);
    let mut count = 0;
    loop {
        // read_until is bounded using take, so one malicious line cannot allocate unlimited RAM.
        let mut line = Vec::new();
        let size = reader
            .by_ref()
            .take(2_097_153)
            .read_until(b'\n', &mut line)?;
        if size == 0 {
            break;
        }
        ensure!(
            size <= 2_097_152 && line.last() == Some(&b'\n'),
            "invalid or oversized JSONL row"
        );
        let value: Value =
            serde_json::from_slice(&line).map_err(|_| anyhow::anyhow!("invalid JSONL document"))?;
        ensure!(value.is_object(), "JSONL row must be an object");
        consume(value)?;
        count += 1;
    }
    Ok(count)
}
fn check_manifest(path: &Path) -> Result<Snapshot> {
    let directory = path
        .parent()
        .context("manifest directory missing")?
        .canonicalize()?;
    let mut bytes = Vec::new();
    regular_file(path)?
        .take(1_048_577)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 1_048_576, "manifest too large");
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("invalid manifest"))?;
    ensure!(
        manifest.format_version == 1
            && manifest.project_id == PROJECT
            && manifest.completed
            && !manifest.password_credentials_exported,
        "unsupported or incomplete export"
    );
    ensure!(
        manifest.files.len() == NAMES.len(),
        "unexpected export files"
    );
    let mut seen = HashSet::new();
    let mut users = HashSet::new();
    let mut emails = HashSet::new();
    let mut paths = HashSet::new();
    for file in &manifest.files {
        ensure!(
            NAMES.contains(&file.name.as_str()) && seen.insert(file.name.clone()),
            "unsafe or duplicate export name"
        );
        let file_path = directory.join(&file.name);
        let mut input = regular_file(&file_path)?;
        let mut hash = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut length = 0_u64;
        loop {
            let size = input.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            length += size as u64;
            hash.update(&buffer[..size]);
        }
        ensure!(
            length == file.bytes && hex::encode(hash.finalize()) == file.sha256,
            "export checksum mismatch"
        );
        let count = each_row(&file_path, |row| {
            match file.name.as_str() {
                "auth-users.jsonl" => {
                    let uid = row["uid"].as_str().context("identity missing")?;
                    ensure!(
                        !uid.is_empty()
                            && uid.chars().count() <= 128
                            && !uid.chars().any(char::is_control)
                            && users.insert(uid.to_owned()),
                        "invalid or duplicate identity"
                    );
                    if let Some(email) = row["email"].as_str() {
                        ensure!(
                            email.len() <= 254
                                && email.contains('@')
                                && emails.insert(email.trim().to_ascii_lowercase()),
                            "invalid or duplicate email"
                        );
                    }
                }
                "firestore.jsonl" => {
                    let path = row["path"].as_str().context("document path missing")?;
                    ensure!(
                        !path.is_empty()
                            && path.len() <= 6144
                            && !path.chars().any(char::is_control)
                            && path.split('/').count() % 2 == 0
                            && paths.insert(path.to_owned())
                            && row["data"].is_object(),
                        "invalid or duplicate document"
                    );
                }
                _ => {
                    ensure!(
                        row["bucket"].is_string() && row["name"].is_string(),
                        "invalid object reference"
                    );
                }
            }
            Ok(())
        })?;
        ensure!(count == file.rows, "export row count mismatch");
    }
    Ok(Snapshot {
        directory,
        manifest,
    })
}

async fn apply(pool: &PgPool, snapshot: &Snapshot) -> Result<Value> {
    let mut tx = pool.begin().await?;
    // Exclusive locks make the empty-target gate hold until commit. Never overwrite a live database.
    sqlx::query("LOCK TABLE accounts, profiles, migration_documents IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let occupied: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM profiles) OR EXISTS(SELECT 1 FROM migration_documents)").fetch_one(&mut *tx).await?;
    ensure!(!occupied, "destination is not empty; import refused");
    let batch = Uuid::new_v4();
    let mut staged = 0_u64;
    let mut accounts = 0_u64;
    // Revalidate the entire source inside the locked transaction before the first write.
    let fresh = check_manifest(&snapshot.directory.join("manifest.json"))?;
    for file in &fresh.manifest.files {
        let mut reader = BufReader::new(regular_file(&fresh.directory.join(&file.name))?);
        let mut digest = Sha256::new();
        let mut read_bytes = 0_u64;
        let mut read_rows = 0_u64;
        loop {
            let mut line = Vec::new();
            let size = reader
                .by_ref()
                .take(2_097_153)
                .read_until(b'\n', &mut line)?;
            if size == 0 {
                break;
            }
            ensure!(
                size <= 2_097_152 && line.last() == Some(&b'\n'),
                "source changed during import"
            );
            digest.update(&line);
            read_bytes += size as u64;
            read_rows += 1;
            let row: Value = serde_json::from_slice(&line)
                .map_err(|_| anyhow::anyhow!("source changed during import"))?;
            let source_key = match file.name.as_str() {
                "auth-users.jsonl" => {
                    format!("auth/{}", row["uid"].as_str().context("identity missing")?)
                }
                "firestore.jsonl" => format!(
                    "firestore/{}",
                    row["path"].as_str().context("document path missing")?
                ),
                _ => format!(
                    "storage/{}",
                    hex::encode(Sha256::digest(serde_json::to_vec(&json!([
                        row["bucket"],
                        row["name"]
                    ]))?))
                ),
            };
            sqlx::query("INSERT INTO migration_documents(path,data,batch_id) VALUES($1,$2,$3)")
                .bind(source_key)
                .bind(&row)
                .bind(batch)
                .execute(&mut *tx)
                .await?;
            staged += 1;
            if file.name == "auth-users.jsonl" {
                // Identities without an email remain staged for explicit provider relinking.
                if let Some(email) = row["email"].as_str() {
                    let uid = row["uid"].as_str().context("identity missing")?;
                    sqlx::query("INSERT INTO accounts(id,email,email_verified,suspended,role) VALUES($1,$2,$3,$4,'user')")
                        .bind(uid).bind(email.trim().to_ascii_lowercase()).bind(row["emailVerified"].as_bool().unwrap_or(false)).bind(row["disabled"].as_bool().unwrap_or(true)).execute(&mut *tx).await?;
                    // Business data stays hidden until its contract-specific migration is validated.
                    sqlx::query("INSERT INTO profiles(user_id,visibility) VALUES($1,'hidden')")
                        .bind(uid)
                        .execute(&mut *tx)
                        .await?;
                    accounts += 1;
                }
            }
        }
        ensure!(
            read_bytes == file.bytes
                && read_rows == file.rows
                && hex::encode(digest.finalize()) == file.sha256,
            "source changed during import"
        );
    }
    // Restrictions take precedence over Auth flags, and deletion tombstones never reactivate.
    let restrictions = sqlx::query("SELECT data->'data' AS restriction,substr(path,length('firestore/accountRestrictions/')+1) AS uid FROM migration_documents WHERE path LIKE 'firestore/accountRestrictions/%'").fetch_all(&mut *tx).await?;
    for row in restrictions {
        let restriction: Value = row.get("restriction");
        let suspended = ["suspended", "deleted", "deletionPending"]
            .iter()
            .any(|key| restriction.get(*key) == Some(&Value::Bool(true)));
        let deleted = restriction["deleted"] == json!(true);
        sqlx::query("UPDATE accounts SET suspended=suspended OR $2,deleted_at=CASE WHEN $3 THEN now() ELSE deleted_at END WHERE id=$1")
            .bind(row.get::<String,_>("uid")).bind(suspended).bind(deleted).execute(&mut *tx).await?;
    }
    // Convert each collection with the API's own allowlists. No password,
    // session, admin grant or plaintext key is synthesized.
    let media_origin = std::env::var("PROFILE_MEDIA_ORIGIN").ok();
    let migrated =
        campusmate_backend::migrate_import::transform(&mut tx, media_origin.as_deref()).await?;
    tx.commit().await?;
    Ok(json!({
        "batchId": batch, "stagedDocuments": staged, "accounts": accounts,
        "profilesActivated": migrated["imported"]["profiles"].as_u64().unwrap_or(0),
        "migration": migrated,
    }))
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut manifest = None;
    let mut write = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" if manifest.is_none() => {
                manifest = Some(PathBuf::from(
                    args.next().context("--manifest requires a path")?,
                ));
            }
            "--apply" if !write => write = true,
            _ => bail!("usage: import-export --manifest PATH [--apply]"),
        }
    }
    let snapshot = check_manifest(&manifest.context("--manifest required")?)?;
    if !write {
        println!(
            "{}",
            json!({"validated":true,"project":PROJECT,"rows":snapshot.manifest.files.iter().map(|f|f.rows).sum::<u64>(),"applied":false})
        );
        return Ok(());
    }
    let url = campusmate_backend::database::migration_url()?;
    let options = campusmate_backend::database::configured_migration_options(&url)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|_| anyhow::anyhow!("database connection failed"))?;
    // Schema migrations must be applied separately by an operator with DDL privileges.
    match apply(&pool, &snapshot).await {
        Ok(report) => println!("{report}"),
        Err(_) => bail!("import refused or rolled back; no source values are logged"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cleanup(directory: PathBuf) {
        let resolved = directory.canonicalize().unwrap();
        assert_eq!(
            resolved.parent().unwrap(),
            std::env::temp_dir().canonicalize().unwrap()
        );
        assert!(resolved
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("campus-import-test-"));
        fs::remove_dir_all(resolved).unwrap();
    }
    fn snapshot() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("campus-import-test-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let files: Vec<Value> = NAMES.into_iter().map(|name| {
            let text = if name == "auth-users.jsonl" { "{\"uid\":\"originalUid\",\"email\":\"student@example.test\",\"emailVerified\":true,\"disabled\":false}\n" } else { "" };
            fs::write(directory.join(name), text).unwrap();
            json!({"name":name,"rows":if text.is_empty(){0}else{1},"bytes":text.len(),"sha256":hex::encode(Sha256::digest(text))})
        }).collect();
        fs::write(directory.join("manifest.json"), json!({"format_version":1,"project_id":PROJECT,"completed":true,"password_credentials_exported":false,"files":files}).to_string()).unwrap();
        directory
    }
    #[test]
    fn checks_bytes_hashes_counts_and_forbids_file_traversal() {
        let directory = snapshot();
        let manifest = directory.join("manifest.json");
        assert!(check_manifest(&manifest).is_ok());
        fs::write(directory.join("auth-users.jsonl"), "tampered\n").unwrap();
        assert!(check_manifest(&manifest).is_err());
        let mut value: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        value["files"][0]["name"] = json!("../auth-users.jsonl");
        fs::write(&manifest, value.to_string()).unwrap();
        assert!(check_manifest(&manifest).is_err());
        cleanup(directory);
    }
    fn full_snapshot() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("campus-import-test-full-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let b64 = |n: usize| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, vec![1_u8; n])
        };
        let auth = [
            json!({"uid":"alice","email":"6600000001@psu.ac.th","emailVerified":true,"disabled":false,"providers":[{"providerId":"password","uid":"6600000001@psu.ac.th"}]}),
            json!({"uid":"bob","email":"6600000002@psu.ac.th","emailVerified":true,"disabled":false,"providers":[{"providerId":"google.com","uid":"1234567890"}]}),
        ];
        let doc = |path: &str, data: Value| json!({"path":path,"id":path.rsplit('/').next().unwrap(),"collection":"","create_time_ms":1_700_000_000_000_i64,"data":data});
        let firestore = [
            doc(
                "users/alice",
                json!({"name":"Alice","age":21,"isFaceVerified":true,"email":"secret@x","role":"admin","encryptionDevices":{"phone":{"publicKey":b64(32)}}}),
            ),
            doc(
                "users/bob",
                json!({"name":"Bob","age":22,"isFaceVerified":true}),
            ),
            doc("profileVisibility/bob", json!({"mode":"incognito"})),
            doc(
                "decisions/alice_bob",
                json!({"fromUserId":"alice","toUserId":"bob","type":"like","status":"accepted","createdAt":1_700_000_000_000_i64}),
            ),
            doc(
                "decisions/bob_alice",
                json!({"fromUserId":"bob","toUserId":"alice","type":"like","status":"accepted"}),
            ),
            doc(
                "conversations/c-alice-bob",
                json!({"participants":["alice","bob"],"unreadCounts":{"bob":2},"participantSettings":{"bob":{"isMuted":true}},
                "messages":[{"id":"legacy-1","senderId":"alice","encrypted":true,"encryptionVersion":1,"nonce":b64(24),"ciphertext":b64(40),"createdAt":1_700_000_000_001_i64},
                            {"senderId":"alice","text":"plaintext legacy","createdAt":1_700_000_000_002_i64}]}),
            ),
            doc(
                "conversations/c-alice-bob/messages/m-2",
                json!({"senderId":"bob","encrypted":true,"encryptionVersion":1,"nonce":b64(24),"ciphertext":b64(50),"createdAt":1_700_000_000_003_i64,"reactions":{"alice":"❤️"},"preview":"leak"}),
            ),
            doc(
                "spots/spot-library",
                json!({"name":"Library","latitude":7.0,"longitude":100.5}),
            ),
        ];
        let lines = |rows: &[Value]| {
            rows.iter()
                .map(|r| {
                    format!(
                        "{r}
"
                    )
                })
                .collect::<String>()
        };
        let contents = [
            ("auth-users.jsonl", lines(&auth), 2),
            ("firestore.jsonl", lines(&firestore), firestore.len()),
            ("storage-objects.jsonl", String::new(), 0),
        ];
        let files: Vec<Value> = contents.iter().map(|(name, text, rows)| {
            fs::write(directory.join(name), text).unwrap();
            json!({"name":name,"rows":rows,"bytes":text.len(),"sha256":hex::encode(Sha256::digest(text))})
        }).collect();
        fs::write(directory.join("manifest.json"), json!({"format_version":1,"project_id":PROJECT,"completed":true,"password_credentials_exported":false,"files":files}).to_string()).unwrap();
        directory
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn imports_every_collection_with_live_allowlists(pool: PgPool) {
        let directory = full_snapshot();
        let source = check_manifest(&directory.join("manifest.json")).unwrap();
        let report = apply(&pool, &source).await.unwrap();
        assert_eq!(report["profilesActivated"], 2, "{report}");
        let account = sqlx::query(
            "SELECT legacy_password,google_subject,role FROM accounts WHERE id='alice'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(account.get::<bool, _>("legacy_password"));
        assert_eq!(
            account.get::<String, _>("role"),
            "user",
            "admin flags are not imported"
        );
        let google: Option<String> =
            sqlx::query_scalar("SELECT google_subject FROM accounts WHERE id='bob'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(google.as_deref(), Some("1234567890"));
        let raw: Value = sqlx::query_scalar("SELECT raw FROM profiles WHERE user_id='alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(raw, json!({"name":"Alice","age":21}));
        let visibility: String =
            sqlx::query_scalar("SELECT visibility FROM profiles WHERE user_id='bob'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(visibility, "incognito");
        let active: bool =
            sqlx::query_scalar("SELECT active FROM conversations WHERE id='c-alice-bob'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(active);
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM encrypted_messages ORDER BY sequence")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            ids,
            vec!["legacy-1", "m-2"],
            "plaintext legacy records are not imported"
        );
        let stored: Value =
            sqlx::query_scalar("SELECT ciphertext FROM encrypted_messages WHERE id='m-2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(stored.get("preview").is_none());
        let member =
            sqlx::query("SELECT unread,muted FROM conversation_members WHERE user_id='bob'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(member.get::<i32, _>("unread"), 2);
        assert!(member.get::<bool, _>("muted"));
        let devices: i64 = sqlx::query_scalar("SELECT count(*) FROM encryption_devices")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(devices, 1);
        let spots: i64 = sqlx::query_scalar("SELECT count(*) FROM spots")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(spots, 1);
        cleanup(directory);
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn preserves_identity_and_refuses_to_overwrite_existing_target(pool: PgPool) {
        let directory = snapshot();
        let source = check_manifest(&directory.join("manifest.json")).unwrap();
        let report = apply(&pool, &source).await.unwrap();
        assert_eq!(report["profilesActivated"], 0);
        let row = sqlx::query("SELECT a.id,a.role,a.password_hash,p.visibility FROM accounts a JOIN profiles p ON p.user_id=a.id").fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<String, _>("id"), "originalUid");
        assert_eq!(row.get::<String, _>("role"), "user");
        assert!(row.get::<Option<String>, _>("password_hash").is_none());
        assert_eq!(row.get::<String, _>("visibility"), "hidden");
        assert!(apply(&pool, &source).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM accounts")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        cleanup(directory);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn write_failure_rolls_back_already_imported_accounts_and_documents(pool: PgPool) {
        let directory = snapshot();
        let manifest_path = directory.join("manifest.json");
        let object = "{\"bucket\":\"test-bucket\",\"name\":\"same-object\"}\n";
        let duplicate = object.repeat(2);
        fs::write(directory.join("storage-objects.jsonl"), &duplicate).unwrap();
        let mut manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        let file = manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|f| f["name"] == "storage-objects.jsonl")
            .unwrap();
        *file = json!({"name":"storage-objects.jsonl","rows":2,"bytes":duplicate.len(),"sha256":hex::encode(Sha256::digest(&duplicate))});
        fs::write(&manifest_path, manifest.to_string()).unwrap();
        let source = check_manifest(&manifest_path).unwrap();
        // Duplicate object keys cause a late SQL constraint failure, after Auth rows were staged.
        assert!(apply(&pool, &source).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM accounts")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM migration_documents")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        cleanup(directory);
    }
}
