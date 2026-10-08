async function run() {
  console.log("Calling deleteNonPsuUsersFunc...");
  try {
    const res = await fetch("https://us-central1-campusmate-7f1ab.cloudfunctions.net/deleteNonPsuUsersFunc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data: {} })
    });
    
    if (!res.ok) {
      console.error("Failed:", res.status, res.statusText);
      const text = await res.text();
      console.error(text);
      return false;
    }
    
    const json = await res.json();
    console.log("Result:", json);
    return true;
  } catch(e) {
    console.error(e.message);
    return false;
  }
}

async function loop() {
  while (true) {
    const success = await run();
    if (success) {
      console.log("Done!");
      break;
    }
    console.log("Retrying in 5 seconds...");
    await new Promise(r => setTimeout(r, 5000));
  }
}
loop();
