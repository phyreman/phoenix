(function(){
  if (!window.BarcodeDetector) {
    //alert("BarcodeDetector API not found");
    return;
  }

  // Register the Service Worker, if able; then listen for app updates and prompt to upgrade
  let iSW;

  reload.addEventListener("click", () => iSW.postMessage({ action: "skipWaiting" }));

  navigator.serviceWorker.register("sw.js", { scope: location.pathname })
  .then(reg => {
    reg.addEventListener("updatefound", () => {
      iSW = reg.installing;
      iSW.addEventListener("statechange", function() {
        if (this.state !== "installed") return;
        if (navigator.serviceWorker.controller) notify.hidden = false;
      });
    });
  })
  .catch(err => console.error(err));

  // Reload the page after the serviceWorker controller has changed to the latest version
  let refreshingPage;
  navigator.serviceWorker.addEventListener("controllerchange", event => {
    if (refreshingPage) return;
    location.reload();
    refreshingPage = true;
  });

  // Set variables
  const height = screen.width,
        width = height * (9 / 16),
        constraints = {
          video: {
            aspectRatio: 9/16,
            facingMode: "environment",
            //width: 126, // this is actually the height, no idea why they are reversed...
            height,
            zoom: 3
          },
          audio: false
        },
        detector = new BarcodeDetector({
          formats: ["upc_a", "upc_e"/*, "qr_code"*/]
        }),
        inventory = {};
  let track;

  // Connect to the camera
  navigator.mediaDevices.getUserMedia(constraints)
  .then(stream => {
    cam.style.width = height;
    cam.style.height = width;
    cam.style.marginLeft = `calc(50vw - ${height / 2}px)`;
    track = stream.getVideoTracks()[0];
    cam.srcObject = stream;
    cam.autoplay = true;
    scan_btn.disabled = false;
    torch.disabled = false;
  })
  .catch(err => alert(err));

  // Toggle the flashlight
  torch.addEventListener("click", event => {
    let target = event.target,
        text = target.textContent;

    if (text === "Light On") {
      // Turn light on
      track.applyConstraints({
        advanced: [{ torch: true }]
      }).then(() => {
        target.textContent = "Light Off";
      }).catch(err => alert(err));
    } else {
      // Turn light off
      track.applyConstraints({
        advanced: [{ torch: false }]
      }).then(() => {
        target.textContent = "Light On";
      }).catch(err => alert(err));
    }
  });

  scan_btn.addEventListener("click", event => {
    scan_btn.disabled = true;
    scan();
  });

  count_dialog.addEventListener("close", function(event) {
    if (this.returnValue === "default") {
      // Form was submitted
      const upc = out.textContent;
      if (inventory[upc] === undefined) inventory[upc] = 0;
      inventory[upc] += Number(count.value);
    }
    scan_btn.disabled = false;
    cam.play();
    count.value = "";
  });

  settings_dialog.addEventListener("close", function(event) {
    const rval = this.returnValue;
    if (rval === "cancel") return;
    if (rval === "export") {
      const type = export_type.value;
      if (type === "csv") {
        saveAs(`upc,count\r\n${JSON.stringify(inventory).slice(1).slice(0,-1).replaceAll('"',"").split(",").map(item => item.replace(":", ",")).join("\r\n")}`, "count.csv", "text/csv");
        //TODO Enable once exports are tested
        //inventory = {};
      }
      return;
    }
    localStorage.beep_tone = beep_tone.value;
    localStorage.beep_time = beep_time.valueAsNumber / 1000;
    localStorage.beep_vol = beep_vol.valueAsNumber / 100;
  });

  // Update UI with user-defined settings, if set
  if (localStorage.beep_tone) beep_tone.value = localStorage.beep_tone;
  if (localStorage.beep_time) beep_time.valueAsNumber = localStorage.beep_time;
  if (localStorage.beep_vol) beep_vol.valueAsNumber = localStorage.beep_vol;

  // Play the beep tone whenever they change the settings for it
  beep_tone.onchange = beep;
  beep_time.onchange = beep;
  beep_vol.onchange = beep;

  function scan() {
    // Detect barcodes
    detector
    .detect(cam)
    .then(barcodes => {
      if (barcodes.length < 1) {
        requestAnimationFrame(scan);
        return;
      }
      let captured = false;
      /**
       * barcode.boundingBox = Dimensions of a rectangle representing the detected barcode
       * barcode.cornerPoints = The x and y coordinates of the four corners of the barcode relative to the image starting from the top-left
       * barcode.format = The detected barcode format
       * barcode.rawValue = A string decoded from the barcode data
       */
      const barcode = barcodes[0],
            format = barcode.format;
      let data = barcode.rawValue;

      // UPC-A / UPC-E
      if (format === "upc_a" && isValidUPC(data)) {
        beep();
        getCount(data);
        captured = true;
      }

      if (format === "upc_e") {
        data = expandUPC(data);
        if (isValidUPC(data)) {
          beep();
          getCount(data);
          captured = true;
        }
      }

      // QR Code
      /*if (format === "qr_code") {
        beep();
        captured = true;
        scan_btn.disabled = false;
        // If the data is a web address, ask to open it
        if (/^https?:\/\//.test(data)) {
          if (confirm(`Would you like to open '${data}' in a new tab?`)) {
            open(data, "_blank", "noreferrer");
          }
        }
        // If it's only numbers, treat it like a UPC
        //if (/^[0-9]*$/.test(data) && isValidUPC(data)) {
        //  getCount(data);
        //}
      }*/

      // Scan until a barcode is captured, then enable the scan button
      if (!captured) requestAnimationFrame(scan);
    }).catch(err => alert(err));
  }

  // Calculates the check digit of a UPC-A number and validates it against the last digit
  function isValidUPC(upc) {
    if (upc.length !== 12) throw RangeError("UPC must be exactly 12 digits long");
    const split = String(upc).split('').map(digit => Number(digit)),
          checkDigit = (((split[0] + split[2] + split[4] + split[6] + split[8] + split[10]) * 3) + split[1] + split[3] + split[5] + split[7] + split[9]) % 10;
    return Number(upc[11]) === (checkDigit === 0 ? 0 : 10 - checkDigit);
  }

  // Expands UPC-E barcode to UPC-A format
  function expandUPC(upce) {
    if (typeof upce !== "string") upce = `${upce}`;
    let len = upce.length;
    if (len !== 8) throw Error(`UPC must be exactly 8 digits`);

    // Extract prefix, assume zero if omitted
    let prefix = "0";
    if (len > 6) {
      prefix = upce[0];
      upce = upce.slice(1);
      len--;
    }

    // Extract Check Digit
    let checkDigit;
    if (len > 6) {
      checkDigit = upce.slice(-1);
      upce = upce.slice(0, -1);
      len--;
    }

    let upca = `${prefix}${upce[0]}${upce[1]}`;
    const TRI = `${upce[2]}${upce[3]}${upce[4]}`;
    switch (upce[5]) {
      case "0":
      case "1":
      case "2":
        upca += `${upce[5]}0000${TRI}`;
        break;
      case "3":
        upca += `${upce[2]}00000${upce[3]}${upce[4]}`;
        break;
      case "4":
        upca += `${upce[2]}${upce[3]}00000${upce[4]}`;
        break;
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        upca += `${TRI}0000${upce[5]}`;
        break;
      default:
        break;
    }
    return `${upca}${checkDigit}`;
  }

  function getCount(upc) {
    out.textContent = upc;
    total.textContent = `Total: ${inventory[upc] || 0}`;
    cam.pause();
    count_dialog.showModal();
  }

  // Play a beep noise
  function beep() {
    const ctx = new AudioContext(),
          osc = ctx.createOscillator(),
          gainNode = ctx.createGain();

    // Connect oscillator and gain nodes
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Set volume
    gainNode.gain.value = beep_vol.valueAsNumber / 100;

    // Set wave type and frequency
    osc.type = "square";
    osc.frequency.value = beep_tone.value;

    // Disconnect audio nodes when finished playing
    osc.onended = () => {
      osc.disconnect();
      gainNode.disconnect();
    };

    // Play sound
    osc.start();
    osc.stop(beep_time.valueAsNumber / 1000);
  }

  // Creates a file save prompt for a given input
  const saveAs = (data, filename = "untitled", type = "text/plain") => {
    switch (typeof data) {
      case "undefined":
        throw Error("No data or variable is not yet initialized");
      // Symbols are for in-program use and not meant to be viewed/saved to disk
      case "symbol":
        throw Error("Symbols cannot be resolved to a serializable form");
      case "string":
      case "number":
      case "bigint":
      case "boolean":
      case "function":
        // Text and numbers are stored as UTF-8 formatted plaintext
        data = new Blob([data], { type });
        break;
      case "object":
        // Weak implementations are meant for in-program use, just like Symbols
        if (data instanceof WeakMap || data instanceof WeakSet)
          throw Error("WeakSet and WeakMap cannot be enumerated, thus cannot be traversed and saved");
        // Arrays and Sets are stored simply as a comma-delimited list of values
        if (Array.isArray(data)) data = new Blob([data], { type });
        if (data instanceof Set) data = new Blob([[...data]], { type });
        // Maps are converted into key-value pairs, object values are turned into JSON strings, then the
        // keypairs are bundled into a multi-line string separated by Windows style newlines
        if (data instanceof Map) {
          data = [...data].map(x => {
            let [key, value] = [...x];
            switch (typeof value) {
              case "object":
                return `${key} = ${JSON.stringify(value)}`;
              default:
                return `${key} = ${value}`;
            }
          }).join("\r\n");
          data = new Blob([data], { type });
        }
        // Objects without an arrayBuffer property (which would be a Blob) can be turned into a JSON string and saved as such
        if (!data.arrayBuffer) data = new Blob([JSON.stringify(data)], { type: "application/json" });
        break;
      default:
        throw Error("Data type not supported");
    }
    // Turn our Blob into a data uri
    const url = window.URL.createObjectURL(data);
    const a = document.createElement('a');
    // Set the <a> tag attributes to allow a file download
    a.download = filename;
    // Add the data uri
    a.href = url;
    a.style.display = "none";
    // Then append the hidden <a> tag to the body and click it to open a save dialog box
    document.body.appendChild(a);
    a.click();
    // Finally, clean up!
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };
})();