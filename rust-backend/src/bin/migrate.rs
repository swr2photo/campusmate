//! Run separately using the DDL deployment identity; API never migrates production.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(
        args.is_empty() || args == ["--runtime-grants"],
        "usage: migrate [--runtime-grants]"
    );
    let url = campusmate_backend::database::migration_url()?;
    let options = campusmate_backend::database::configured_migration_options(&url)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|_| anyhow::anyhow!("database connection failed"))?;
    sqlx::migrate!()
        .run(&pool)
        .await
        .map_err(|_| anyhow::anyhow!("database migration failed"))?;
    println!("schema migrations applied");
    if !args.is_empty() {
        sqlx::raw_sql(include_str!("../../operations/runtime-grants.sql"))
            .execute(&pool)
            .await
            .map_err(|_| anyhow::anyhow!("runtime grants failed"))?;
        println!("runtime capability grants applied");
    }
    Ok(())
}
