const nzfsdb = require('nzfsdb');
const { getHASH, hasJsonStructure } = require('nzfunc');
const { networkInterfaces } = require('os');

class nznode {
	CONFIG;
	nodes;

	constructor(CONFIG) {
		this.CONFIG = CONFIG;
		this.nodes = {};
		try {
			if (this.CONFIG.db !== undefined) {
				let DB = new nzfsdb(this.CONFIG.db);
				if (!DB.checkExists()) throw new Error('DB folder does not exist');
				this.DB = DB;
				if (!this.DB.checkExists(null, 'nodes.json')) throw new Error('nodes.json does not exist');
				let nodes = this.DB.read(null, 'nodes.json');
				if (hasJsonStructure(nodes)) this.nodes = JSON.parse(nodes);
				if (this.CONFIG.log) console.log(this.nodes);
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async add(node = { keyID: 'keyID', net: 'ALPHA', prot: 'http', host: '127.0.0.1', port: 28262, ping: 10 } ) {
		try {
			this.nodes[node.keyID] = {
				net: node.net,
				prot: node.prot,
				host: node.host,
				port: node.port,
				ping: node.ping
			};
			if (this.DB !== undefined) {
				this.DB.write(null, 'nodes.json', JSON.stringify(this.nodes));
			}
			if (this.CONFIG.log) console.log('\x1b[1m%s\x1b[0m', 'New node:', node.keyID, node.host + ':' + node.port, `(${node.ping} ms)`);
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async remove(keyID) {
		try {
			if (this.CONFIG.log) console.log('\x1b[1m%s\x1b[0m', 'Node removed:', keyID, this.nodes[keyID].host + ':' + this.nodes[keyID].port);
			delete this.nodes[keyID];
			if (this.DB !== undefined) {
				this.DB.write(null, 'nodes.json', JSON.stringify(this.nodes));
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async getNodeHash(node = { net: 'ALPHA', prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			if (!node.net) throw new Error('Unknown parameter net');
			if (!node.host) throw new Error('Unknown parameter host');
			if (!node.port) throw new Error('Unknown parameter port');
			let hash = await getHASH(JSON.stringify({
				net: node.net,
				prot: node.prot,
				host: node.host,
				port: node.port
			}), 'md5');
			return hash;
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			return false;
		}
	}

	async getInfo(address = { prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			let url = address.prot + '://' + address.host + ':' + address.port + '/info';
			let pingStart = new Date().getTime();
			let response = await fetch(url);
			let pingFinish = new Date().getTime();
			let ping = pingFinish - pingStart;
			if (response.ok) {
				let info = await response.json();
				info.port = parseInt(info.port);
				info.keyID = await this.getNodeHash(info);
				info.ping = ping;
				return info;
			} else {
				return false;
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			return false;
		}
	}

	async getNodes(address = { prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			let url = address.prot + '://' + address.host + ':' + address.port + '/getNodes';
			let response = await fetch(url);
			if (response.ok) {
				let list = await response.json();
				let keys = Object.keys(list);
				for (let i = 0, l = keys.length; i < l; i++) {
					if ((this.nodes[keys[i]] === undefined)
					&& (list[keys[i]].net === this.CONFIG.net)
					&& (keys[i] !== this.CONFIG.keyID)) {
						this.add({
							keyID: keys[i],
							net: list[keys[i]].net,
							prot: list[keys[i]].prot,
							host: list[keys[i]].host,
							port: list[keys[i]].port,
							ping: 10
						});
					}
				}
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			return false;
		}
	}

	async sendMessage(address = { prot: 'http', host: '127.0.0.1', port: 28262 }, message = {}) {
		try {
			let url = address.prot + '://' + address.host + ':' + address.port + '/';
			await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': (JSON.stringify(message)).length
				},
				body: JSON.stringify(message)
			});
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async sendMessageToAll(message = {}) {
		try {
			let keys = Object.keys(this.nodes);
			for (let i = 0, l = keys.length; i < l; i++) {
				await this.sendMessage({
					prot: this.nodes[keys[i]].prot,
					host: this.nodes[keys[i]].host,
					port: this.nodes[keys[i]].port
				}, message);
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async sendHandshake(node = { prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			let address = {
				net: this.CONFIG.net,
				prot: this.CONFIG.prot,
				host: this.CONFIG.host,
				port: this.CONFIG.port
			};
			await this.sendMessage(node, { handshake: address });
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async checkNodeInDB(node = { net: 'ALPHA', port: 'http', host: '127.0.0.1', port: 28262, ping: 10 }) {
		try {
			if (node.keyID === this.CONFIG.keyID) throw new Error('This is this node');
			let hash = await this.getNodeHash(node);
			if (!hash) throw new Error('Unknown parameter hash');
			if (node.net !== this.CONFIG.net) throw new Error('The node is not from our network');
			if (!this.nodes[hash]) {
				this.add({
					keyID: hash,
					net: node.net,
					prot: node.prot,
					host: node.host,
					port: node.port,
					ping: node.ping
				});
			} else {
				this.nodes[hash].ping = node.ping;
			}
			await this.sendHandshake(node);
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
		}
	}

	async checkingNodes() {
		let keys = Object.keys(this.nodes);
		if (keys.length > 0) for (let i = 0, l = keys.length; i < l; i++) {
			try {
				var node = await this.getInfo({
					prot: this.nodes[keys[i]].prot,
					host: this.nodes[keys[i]].host,
					port: this.nodes[keys[i]].port
				});
				if (node !== false) {
					if ((node.keyID !== keys[i])
					|| (node.keyID === this.CONFIG.keyID)) this.remove(keys[i]);
					await this.checkNodeInDB(node);
					if (node.keyID !== this.CONFIG.keyID) await this.getNodes(node);
				} else {
					this.remove(keys[i]);
				}
			} catch(e) {
				if (this.CONFIG.log) console.log(e);
			}
		} else {
			await this.firstNodeSearch();
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
		let prot, host, port;
		for (let i = 1, l = 255; i < l; i++) {
			try {
				prot = 'http';
				host = addr[0] + '.' + addr[1] + '.' + addr[2] + '.' + i;
				port = '28262';
				if (host !== this.CONFIG.host) {
					var node = await this.getInfo({ prot: prot, host: host, port: port });
					if ((node !== false) && (node.net === this.CONFIG.net)) await this.checkNodeInDB(node);
				}
			} catch(e) {
				if (this.CONFIG.log) console.log(e);
			}
		}
	}

	async getMessage(keyID = 'someKeyMessage', address = { prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			let url = address.prot + '://' + address.host + ':' + address.port + '/getMessage?' + keyID;
			let response = await fetch(url);
			if (response.ok) {
				let message = await response.json();
				return message;
			} else {
				return false;
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			return false;
		}
	}

	async getMessages(address = { prot: 'http', host: '127.0.0.1', port: 28262 }) {
		try {
			let url = address.prot + '://' + address.host + ':' + address.port + '/getMessages';
			let response = await fetch(url);
			if (response.ok) {
				let list = await response.json();
				return list;
			} else {
				return false;
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			return false;
		}
	}

	async firstNodeSearch() {
		try {
			let response = await fetch('https://raw.githubusercontent.com/JeBance/nzserver/refs/heads/gh-pages/hosts.json');
			if (response.ok) {
				let list = await response.json();
				let keys = Object.keys(list);
				for (let i = 0, l = keys.length; i < l; i++) {
					if (this.nodes[keys[i]] === undefined)
					await this.add({
						keyID: keys[i],
						net: list[keys[i]].net,
						prot: list[keys[i]].prot,
						host: list[keys[i]].host,
						port: list[keys[i]].port,
						ping: 10
					});
				}
			} else {
				if (this.CONFIG.log) console.log(response.status);
			}
		} catch(e) {
			if (this.CONFIG.log) console.log(e);
			process.exit(1);
		}
	}


	async searchNodesInLocalNetwork() {
		// search nodes in local network
		if (this.CONFIG.scan !== undefined && this.CONFIG.scan === 'on') {
			console.log('Local network scan started');
			this.searchingNodes();
		}
	}

	async checkNodes(MESSAGE) {
		// check nodes
		setInterval(async () => {
			await this.checkingNodes();
			// function for synchronizing messages with other nodes
			let messages = {};
			let keys = Object.keys(this.nodes);
			for (let i = 0, l = keys.length; i < l; i++) {
				messages = await this.getMessages(this.nodes[keys[i]]);
				await MESSAGE.updateMessages(messages, this.nodes[keys[i]], this);
			}
		}, this.CONFIG.autoCheckNodes);
	}

}

module.exports = nznode;
