let usageChart, tempChart, memoryGauge, memoryLineChart;
let ws;

// Historical data for line charts.
const historySize = 10;
const gpuHistory = [];
const cpuHistory = [];
const gpuTempHistory = [];
const systemTempHistory = [];
const memoryHistory = [];
const pendingCommands = {};

const dockerActions = {
	'docker-start': {
		label: 'Start',
		pendingLabel: 'Starting…',
		selector: '.start-btn',
		shouldShow: (isRunning, isDashboard) => !isRunning,
		confirm: null
	},
	'docker-stop': {
		label: 'Stop',
		pendingLabel: 'Stopping…',
		selector: '.stop-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && !isDashboard,
		confirm: 'Are you sure you want to stop this container?'
	},
	'docker-restart': {
		label: 'Restart',
		pendingLabel: 'Starting…',
		selector: '.restart-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && isDashboard,
		confirm: 'Are you sure you want to restart this container?'
	}
};

// Consistent colors for GPU and CPU (Dark theme).
const GPU_COLOR = 'rgb(102, 187, 106)'; // #66BB6A
const GPU_BG_COLOR = 'rgba(102, 187, 106, 0.1)';
const CPU_COLOR = 'rgb(33, 150, 243)'; // #2196F3
const CPU_BG_COLOR = 'rgba(33, 150, 243, 0.1)';

function createGauge(canvasId, label, maxValue) {
	const ctx = document.getElementById(canvasId).getContext('2d');

	return new Chart(ctx, {
		type: 'doughnut',
		data: {
			datasets: [{
				data: [0, 80, 10, 5, 5, maxValue], // Green(80), Gray(10), Orange(5), Red(5), Available
				backgroundColor: [
					'#4CAF50', // Bright saturated green - Primary healthy range
					'#424242', // Dark gray - Warning range  
					'#FF9800', // Bright orange - Critical range
					'#F44336', // Vivid red - Maximum danger range
					'#333333', // Dark gray background - Available space
					'#333333'  // Dark gray background - Available space (duplicate for chart logic)
				],
				borderWidth: 0,
				circumference: 180,
				rotation: 270,
				cutout: '60%',
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			aspectRatio: 2,
			plugins: {
				legend: {
					display: false
				},
				tooltip: {
					enabled: false
				},
				annotation: {
					annotations: {
						usedLabel: {
							type: 'doughnutLabel',
							content: '0',
							font: {
								size: 32,
								weight: 'bold'
							},
							color: '#FFFFFF',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '80%'
							}
						},
						totalLabel: {
							type: 'doughnutLabel',
							content: label,
							font: {
								size: 14
							},
							color: '#CCCCCC',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '0%'
							},
						}
					}
				}
			}
		}
	});
}

function updateGauge(chart, value, maxValue) {
	// Truncate so we get 128GB when it's actually 128.5
	maxValue = Math.trunc(maxValue);
	if (value > maxValue) {
		value = maxValue;
	}

	// Calculate segments based on usage percentage
	const usagePercent = (value / maxValue) * 100;
	const greenMax = 80;    // 0-80% green (healthy)
	const grayMax = 90;     // 80-90% gray (warning) 
	const orangeMax = 95;   // 90-95% orange (critical)
	const redMax = 100;     // 95-100% red (maximum danger)

	// Initialize segments array
	// [0=green healthy, 1=warning, 2=critical, 3=danger, 4=available memory]
	const segments = [0, 0, 0, 0, 0]; 
	
	if (usagePercent <= greenMax) {
		// All usage is in green segment (0-80%)
		segments[0] = usagePercent;
		segments[4] = 100 - usagePercent; // Available memory
	} else if (usagePercent <= grayMax) {
		// Usage spans green (0-80%) and warning segments (80-90%)
		segments[0] = greenMax;
		segments[1] = usagePercent - greenMax;
		segments[4] = 100 - usagePercent; // Available memory
	} else if (usagePercent <= orangeMax) {
		// Usage spans green, warning (80-90%), and critical segments (90-95%)
		segments[0] = greenMax;
		segments[1] = grayMax - greenMax;
		segments[2] = usagePercent - grayMax;
		segments[4] = 100 - usagePercent; // Available memory
	} else {
		// Usage spans all segments including danger (95-100%)
		segments[0] = greenMax;
		segments[1] = grayMax - greenMax;
		segments[2] = orangeMax - grayMax;
		segments[3] = usagePercent - orangeMax;
		segments[4] = 100 - usagePercent; // Available memory
	}

	// Update chart data
	chart.data.datasets[0].data = [...segments, maxValue];
	
	// Update labels
	chart.options.plugins.annotation.annotations.usedLabel.content = `${value.toFixed(1)}GB`;
	chart.options.plugins.annotation.annotations.totalLabel.content = `/${maxValue}GB`;
	chart.update('none');
}

function initCharts() {
	// Usage line chart
	const usageCtx = document.getElementById('usage-chart').getContext('2d');
	usageChart = new Chart(usageCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU %',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'CPU %',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Usage %',
						color: '#CCCCCC'
					},
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				},
				x: {
					display: false,
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
					labels: {
						color: '#CCCCCC'
					}
				}
			}
		}
	});

	// Temperature line chart (combined GPU and CPU)
	const tempCtx = document.getElementById('temp-chart').getContext('2d');
	tempChart = new Chart(tempCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU °C',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'System °C',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Temperature °C',
						color: '#CCCCCC'
					},
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				},
				x: {
					display: false,
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
					labels: {
						color: '#CCCCCC'
					}
				}
			}
		}
	});

	memoryGauge = createGauge('memory-gauge', '/128GB', 128);

	const memoryCtx = document.getElementById('memory-chart').getContext('2d');
	memoryLineChart = new Chart(memoryCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'Memory',
				data: [],
				borderColor: 'rgb(76, 175, 80)', // #4CAF50 - Dark theme green
				backgroundColor: 'rgba(76, 175, 80, 0.1)',
				tension: 0.4,
				segment: {
					borderColor: ctx => {
						// Get the max value from the y-axis scale
						const maxValue = ctx.chart.options.scales.y.max;
						const yellowThreshold = maxValue * 0.6;
						const redThreshold = maxValue * 0.8;

						// Get the value at the end of this segment
						const value = ctx.p1.parsed.y;

						if (value >= redThreshold) {
							return 'rgb(244, 67, 54)'; // #F44336 - Red
						} else if (value >= yellowThreshold) {
							return 'rgb(255, 193, 7)'; // Yellow
						} else {
							return 'rgb(76, 175, 80)'; // #4CAF50 - Green
						}
					}
				}
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 128,
					title: {
						display: true,
						text: 'GB',
						color: '#CCCCCC'
					},
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				},
				x: {
					display: false,
					grid: {
						color: '#555555'
					},
					ticks: {
						color: '#CCCCCC'
					}
				}
			},
			plugins: {
				legend: {
					display: false
				}
			}
		}
	});
}

function updateCharts(data) {
	// Convert KB to GB
	const usedGB = data.memory.usedKB / 1000000;
	const totalGB = data.memory.totalKB / 1000000;
	const memoryUsed = parseFloat(usedGB.toFixed(1));

	gpuHistory.push(data.gpu?.usagePercent);
	cpuHistory.push(data.cpu.usagePercent);
	gpuTempHistory.push(data.gpu?.temperatureC);
	systemTempHistory.push(data.temperature.systemTemperatureC);
	memoryHistory.push(memoryUsed);

	if (gpuHistory.length > historySize) {
		gpuHistory.shift();
		cpuHistory.shift();
		gpuTempHistory.shift();
		systemTempHistory.shift();
		memoryHistory.shift();
	}

	// Update usage line chart.
	usageChart.data.labels = Array.from({ length: gpuHistory.length }, (_, i) => i + 1);
	usageChart.data.datasets[0].data = [...gpuHistory];
	usageChart.data.datasets[1].data = [...cpuHistory];
	usageChart.update('none');

	// Update GPU power label.
	document.getElementById('gpu-power-label').textContent =
		`GPU Power: ${data.gpu?.powerW?.toFixed(0) ?? '?'} W`;

	// Update temperature line chart.
	tempChart.data.labels = Array.from({ length: gpuTempHistory.length }, (_, i) => i + 1);
	tempChart.data.datasets[0].data = [...gpuTempHistory];
	tempChart.data.datasets[1].data = [...systemTempHistory];
	tempChart.update('none');

	// Update memory gauge.
	updateGauge(memoryGauge, memoryUsed, totalGB);
	memoryGauge.update('none');

	// Update memory line chart.
	memoryLineChart.data.labels = Array.from({ length: memoryHistory.length }, (_, i) => i + 1);
	memoryLineChart.data.datasets[0].data = [...memoryHistory];
	memoryLineChart.update('none');

	// Update browser tab title.
	const maxUsage = Math.max(data.gpu?.usagePercent ?? 0, data.cpu.usagePercent);
	const maxTemp = Math.max(data.gpu?.temperatureC ?? 0, data.temperature.systemTemperatureC);
	document.title = `DGX ${Math.trunc(usedGB).toFixed(0)}GB ${maxUsage.toFixed(0)}% ${maxTemp.toFixed(0)}°`;

}

function updateDocker(data) {
	const dockerSection = document.getElementById('docker-section');
	const tableBody = document.getElementById('docker-table-body');
	const template = document.getElementById('docker-row-template');

	if (!data.docker || data.docker.length === 0) {
		dockerSection.style.display = 'none';
		return;
	}

	dockerSection.style.display = 'block';
	tableBody.innerHTML = '';

	data.docker.forEach(container => {
		const clone = template.content.cloneNode(true);

		clone.querySelector('.image').textContent = container.image;
		clone.querySelector('.name').textContent = container.names;
		clone.querySelector('.ports').textContent = container.ports;
		clone.querySelector('.cpu').textContent = container.cpu;
		clone.querySelector('.memory').textContent = container.memory;
		clone.querySelector('.status').textContent = `${container.status}`;

		const isRunning = container.status.toLowerCase().startsWith('up ');
		const statusClass = isRunning ? 'status-running' : 'status-stopped';
		const statusLabel = isRunning ? 'Running' : 'Stopped';

		const badge = clone.querySelector('.status-badge');
		badge.textContent = statusLabel;
		badge.classList.add(statusClass);

		const isDashboard = container.names.includes('dgx_dashboard') || container.image.includes('dgx_dashboard');

		// Check for pending commands
		let pending = pendingCommands[container.id];
		if (pending) {
			const elapsed = Date.now() - pending.timestamp;
			// If 10s or status changed, clear pending
			if (elapsed >= 10000 || pending.wasRunning !== isRunning) {
				delete pendingCommands[container.id];
				pending = null;
			}
		}

		Object.entries(dockerActions).forEach(([command, action]) => {
			const btn = clone.querySelector(action.selector);

			let shouldShow = action.shouldShow(isRunning, isDashboard);
			let label = action.label;
			let disabled = false;

			if (pending) {
				if (pending.command === command) {
					shouldShow = true;
					label = action.pendingLabel;
					disabled = true;
				} else {
					shouldShow = false;
				}
			}

			btn.style.display = shouldShow ? 'inline-block' : 'none';
			btn.textContent = label;
			btn.disabled = disabled;
			btn.onclick = () => sendDockerCommand(btn, container.id, command, isRunning);
		});

		tableBody.appendChild(clone);
	});
}

function sendDockerCommand(btn, id, command, wasRunning) {
	const action = dockerActions[command];
	if (action.confirm && !confirm(action.confirm)) return;

	if (ws && ws.readyState === WebSocket.OPEN) {
		pendingCommands[id] = { command, timestamp: Date.now(), wasRunning };
		ws.send(JSON.stringify({ command, id }));
		btn.textContent = action.pendingLabel;
		btn.disabled = true;
	}
}

const statusDiv = document.getElementById('status');
const progressBar = document.getElementById('progress-bar');

function startProgressBar(seconds) {
	if (!progressBar) return;

	progressBar.style.transition = 'none';
	progressBar.style.width = '100%';

	// Force reflow to apply the reset before starting transition.
	progressBar.offsetHeight;

	progressBar.style.transition = `width ${seconds}s linear`;
	requestAnimationFrame(() => progressBar.style.width = '0%');
}

function connect() {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		statusDiv.textContent = 'Connected';
		statusDiv.style.color = '#4ec9b0';
		// Begin progress bar animation assuming default interval of 5 seconds.
		startProgressBar(5);
	};

	ws.onmessage = (event) => {
		const data = JSON.parse(event.data);

		if (!data.gpu) {
			statusDiv.textContent = 'nvidia-smi has crashed too many times, click Restart on the dashboard container';
			statusDiv.style.color = '#f48771';
			console.error('nvidia-smi has crashed, see log output');
		}

		updateCharts(data);
		updateDocker(data);

		// Start or restart the progress bar based on the server-provided interval.
		startProgressBar(data.nextPollSeconds);
	};

	ws.onerror = (error) => {
		statusDiv.textContent = 'Error';
		statusDiv.style.color = '#f48771';
		console.error('WebSocket error:', error);
	};

	ws.onclose = () => {
		statusDiv.textContent = 'Disconnected - Reconnecting...';
		statusDiv.style.color = '#ce9178';
		setTimeout(connect, 1000);
	};
}

// Initialize charts when page loads
document.addEventListener('DOMContentLoaded', () => {
	// Set hostname in the header
	const hostnameElement = document.getElementById('hostname');
	if (hostnameElement) {
		hostnameElement.textContent = window.location.hostname || 'DGX Spark Dashboard';
	}
	
	initCharts();
	connect();
});
