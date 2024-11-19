const { getHASH,
		doRequest,
		getResponse } = require('nzfunc');
const { networkInterfaces } = require('os');

class nznode {
	config;
	nodes;

	constructor(config) {
		this.config = config;
		this.nodes = {};
	}

	async add(node = { keyID: 'keyID', net: 'ALPHA', host: '127.0.0.1', port: 28262, ping: 10 } ) {
		try {
			this.nodes[node.keyID] = {
				net: node.net,
				host: node.host,
				port: node.port,
				ping: node.ping
			};
			console.log('\x1b[1m%s\x1b[0m', 'New node:', node.keyID, node.host + ':' + node.port, `(${node.ping} ms)`);
		} catch(e) {
			console.log(e);
		}
	}

	async remove(keyID) {
		try {
			console.log('\x1b[1m%s\x1b[0m', 'Node removed:', keyID, this.nodes[keyID].host + ':' + this.nodes[keyID].port);
			delete this.nodes[keyID];
		} catch(e) {
			console.log(e);
		}
	}

	async getNodeHash(node = { net: 'ALPHA', host: '127.0.0.1', port: 28262 }) {
		try {
			if (!node.net) throw new Error('Unknown parameter net');
			if (!node.host) throw new Error('Unknown parameter host');
			if (!node.port) throw new Error('Unknown parameter port');
			let hash = await getHASH(JSON.stringify({
				net: node.net,
				host: node.host,
				port: node.port
			}), 'md5');
			return hash;
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async getInfo(address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/info',
				method: 'GET'
			};
			let pingStart = new Date().getTime();
			let req = await doRequest(options);
			let pingFinish = new Date().getTime();
			let ping = pingFinish - pingStart;
			if (req.statusCode == 200) {
				let res = await getResponse(req)
				let info = JSON.parse(res);
				info.ping = ping;
				return info;
			} else {
				return false;
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async getNodes(address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/getNodes',
				method: 'GET'
			};
			let req = await doRequest(options);
			if (req.statusCode == 200) {
				let res = await getResponse(req);
				let list = JSON.parse(res);
				let keys = Object.keys(list);
				for (let i = 0, l = keys.length; i < l; i++) {
					if (this.nodes[keys[i]] === undefined) {
						var node = await this.getInfo({
							host: list[keys[i]].host,
							port: list[keys[i]].port
						});
						if (node !== false) this.add(node);
					}
				}
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async sendMessage(address = { host: '127.0.0.1', port: 28262 }, message = {}) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': (JSON.stringify(message)).length
				}
			};
			await doRequest(options, JSON.stringify(message));
		} catch(e) {
//			console.log(e);
		}
	}

	async sendMessageToAll(message = {}) {
		try {
			let keys = Object.keys(this.nodes);
			for (let i = 0, l = keys.length; i < l; i++) {
				await this.sendMessage({
					host: this.nodes[keys[i]].host,
					port: this.nodes[keys[i]].port
				}, message);
			}
		} catch(e) {
//			console.log(e);
		}
	}

	async sendHandshake(node = { host: '127.0.0.1', port: 28262 }) {
		try {
			let address = {
				net: this.config.net,
				host: this.config.host,
				port: this.config.port
			};
			await this.sendMessage(node, { handshake: address });
		} catch(e) {
//			console.log(e);
		}
	}

	async checkNodeInDB(node = { net: 'ALPHA', host: '127.0.0.1', port: '28262', ping: 10 }) {
		try {
			let hash = await this.getNodeHash(node);
			if (!hash) throw new Error('Unknown parameter hash');
			if (node.net !== this.config.net) throw new Error('The node is not from our network');
			this.add({
				keyID: hash,
				net: node.net,
				host: node.host,
				port: node.port,
				ping: node.ping
			});
			await this.sendHandshake(node);
		} catch(e) {
//			console.log(e);
		}
	}

	async checkingNodes() {
		let keys = Object.keys(this.nodes);
		if (keys.length > 0) for (let i = 0, l = keys.length; i < l; i++) {
			try {
				var node = await this.getInfo({
					net: this.nodes[keys[i]].net,
					host: this.nodes[keys[i]].host,
					port: this.nodes[keys[i]].port
				});
				if ((node !== false) && (node.net === this.config.net)) {
					await this.checkNodeInDB(node);
				} else {
					this.remove(keys[i]);
				}
			} catch(e) {
//				console.log(e);
			}
		}
	}

	async searchingNodes() {
		const nets = networkInterfaces();
		const results = {};
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				// Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
				// 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
				const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
				if (net.family === familyV4Value && !net.internal) {
					if (!results[name]) {
						results[name] = [];
					}
					results[name].push(net.address);
					await this.pingAddresses(net.address);
				}
			}
		}
	}

	async pingAddresses(address) {
		let addr = address.split('.');
		let host, port;
		for (let i = 100, l = 110; i < l; i++) {
			try {
				host = addr[0] + '.' + addr[1] + '.' + addr[2] + '.' + i;
				port = '28262';
				if (host !== this.config.host) {
					var node = await this.getInfo({ host: host, port: port });
					if ((node !== false) && (node.net === this.config.net)) await this.checkNodeInDB(node);
				}
			} catch(e) {
//				console.log(e);
			}
		}
	}

	async getMessage(keyID = 'someKeyMessage', address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/getMessage?' + keyID,
				method: 'GET'
			};
			let req = await doRequest(options);
			if (req.statusCode == 200) {
				let res = await getResponse(req);
				let message = JSON.parse(res);
				return message;
			} else {
				return false;
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async getMessages(address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/getMessages',
				method: 'GET'
			};
			let req = await doRequest(options);
			if (req.statusCode == 200) {
				let res = await getResponse(req);
				let list = JSON.parse(res);
				return list;
			} else {
				return false;
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

}

module.exports = nznode;
