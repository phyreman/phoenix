window.addEventListener("load", event => {
	if (!window.BarcodeDetector) {
		alert("BarcodeDetector API not found. Until the option is enabled, you will not be able to use this app. Please go to 'about://flags/#enable-experimental-web-platform-features' and enable the option, if available.");
		return;
	}

	// Polyfill a "playing" property for media elements to easily check if they're actively playing
	if (!HTMLMediaElement.hasOwnProperty("playing")) {
		Object.defineProperty(HTMLMediaElement.prototype, "playing", {
			get: function() {
				return !!(this.currentTime > 0 && !this.paused && !this.ended && this.readyState > 2);
			}
		});
	}

	// Register the Service Worker, if able; then listen for app updates and prompt to upgrade
	const ServiceWorker = {
		agent: undefined,
		refreshing: false
	};

	update_btn.addEventListener("click", () => ServiceWorker.agent.postMessage({ action: "skipWaiting" }));

	navigator.serviceWorker.register("sw.js", { scope: location.pathname })
	.then(reg => {
		reg.addEventListener("updatefound", () => {
			ServiceWorker.agent = reg.installing;
			ServiceWorker.agent.addEventListener("statechange", function() {
				if (this.state !== "installed") return;
				if (navigator.serviceWorker.controller) update_btn.hidden = false;
			});
		});
	})
	.catch(err => console.error(err));

	// Reload the page after the serviceWorker controller has changed to the latest version
	navigator.serviceWorker.addEventListener("controllerchange", event => {
		if (ServiceWorker.refreshing) return;
		location.reload();
		ServiceWorker.refreshing = true;
	});

	// Set variables
	const height = screen.availWidth,
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
					formats: ["upc_a", "upc_e", "qr_code"]
				}),
				inventory = {};
	let track, isStarted = false;

	document.addEventListener("visibilitychange", () => {
		if (!isStarted) return;
		if (document.visibilityState === "hidden") {
			if (cam.playing) cam.pause();
			return;
		}
		if (cam.paused) cam.play();
	});

	//TODO Use ImageCapture API to get an image to process instead of the raw cam feed

	// Connect to the camera
	navigator.mediaDevices.getUserMedia(constraints)
	.then(stream => {
		track = stream.getVideoTracks()[0];

		Object.assign(cam, { srcObject: stream, autoplay: true });
		Object.assign(cam.style, {
			width: `${height}px`,
			height: `${width}px`,
			marginLeft: `calc(50vw - ${height / 2}px)`
		});
		isStarted = true;

		scan_btn.disabled = false;
		light.disabled = false;
	})
	.catch(err => alert(err));

	// Toggle the flashlight
	light.addEventListener("click", event => {
		const target = event.target;

		track.applyConstraints({
			advanced: [{ torch: (target.textContent === "Light On") }]
		}).then(() => {
			target.textContent = "Light Off";
		}).catch(err => alert(err));
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
				const inventoryString = JSON.stringify(inventory)
																		.slice(1).slice(0,-1)
																		.replaceAll('"',"")
																		.split(",")
																		.map(item => item.replace(":", ","))
																		.join("\r\n");
				saveAs(`upc,count\r\n${inventoryString}`, "count.csv", "text/csv");
				inventory = {};
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
			 * barcode.cornerPoints = The x and y coordinates of the four corners of the barcode relative to the image
			 *                        starting from the top-left
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
			if (format === "qr_code") {
				beep();
				captured = true;
				scan_btn.disabled = false;
				// If the data is a web address, ask to open it
				if (/^https?:\/\//.test(data)) {
					cam.pause();
					if (confirm(`Would you like to open '${data}' in a new tab?`)) {
						open(data, "_blank", "noreferrer");
					} else {
						cam.play();
					}
				}
				// If it's only numbers, treat it like a UPC
				if (/^[0-9]*$/.test(data) && isValidUPC(data)) {
					getCount(data);
				}
			}

			// Scan until a barcode is captured, then enable the scan button
			if (!captured) requestAnimationFrame(scan);
		}).catch(err => alert(err));
	}

	// Validity check is very basic. There's ~11.11111...% chance of a false positive
	const isValidUPC = upc => {
		if (typeof upc !== "string") throw TypeError("Input must be a String");
		if (upc.length !== 12) throw RangeError("UPC must be exactly 12 digits long");
		const nums = upc.split(/:?/).map(digit => parseInt(digit));
		return (((3*nums[0]) + nums[1] + (3*nums[2]) + nums[3] + (3*nums[4]) + nums[5] + (3*nums[6]) + nums[7] + (3*nums[8]) + nums[9]) % 10) === 0;
	};

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
		if (typeof data !== "string") throw TypeError("Input data must be of type String");
		showSaveFilePicker().then(async handle => {
			const stream = await handle.createWritable({
				suggestedName: filename,
				types: [{
					description: "Text File",
					accept: {
						"text/plain": [".txt"]
					}
				}]
			});
			await stream.write(new Blob([data], { type }));
			await stream.close();
		});
	};
});