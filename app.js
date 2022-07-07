(function(){
  if (!window.BarcodeDetector) {
    alert("BarcodeDetector API not found");
    return;
  }

  // Register the Service Worker, if able
  navigator.serviceWorker.register("sw.js", { scope: location.pathname })
  .catch(err => {
    console.error(err);
  });

  // Prepare for install prompt
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    a2hs.hidden = false;
    console.log("Preparing prompt");
    a2hs.addEventListener("click", event => {
      a2hs.hidden = true;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(choiceResult => {
        if (choiceResult.outcome === "accepted") {
          console.log("User accepted A2HS prompt");
        } else {
          console.log("User denied A2HS prompt");
        }
        deferredPrompt = null;
      });
    });
  });

  if (!window.BarcodeDetector) {
    alert("BarcodeDetector API not found");
    return;
  }

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

  dialog.addEventListener("close", event => {
    if (dialog.returnValue === "default") {
      // Form was submitted
      const upc = out.textContent;
      if (!inventory.hasOwnProperty(upc)) inventory[upc] = 0;
      inventory[upc] += Number(count.value);
    }
    scan_btn.disabled = false;
    cam.play();
    count.value = "";
  });

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

  function getCount(msg) {
    out.textContent = msg;
    cam.pause();
    dialog.showModal();
  }

  // Play a beep noise
  function beep() {
    const ctx = new AudioContext(),
          osc = ctx.createOscillator(),
          gainNode = ctx.createGain();

    // Connect oscillator and gain nodes
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Start volume at 50%
    //gainNode.gain.value = 0.5;

    // 1046.5 = C6 - Note 'C' at 6th Octave as a square wave
    osc.type = "square";
    osc.frequency.value = 1046.5;

    osc.onended = function() {
      osc.disconnect();
      gainNode.disconnect();
    };

    // Beep for ~125ms
    osc.start();
    osc.stop(0.125);
  }
})();