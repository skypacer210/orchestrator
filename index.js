/*jshint node:true */

"use strict";

var Orchestrator = function (opts) {
	opts = opts || {};
	this.verbose = opts.verbose || false; // show messages as each task runs
	this.doneCallback = opts.callback; // call this when all tasks in the queue are done
	this.seq = opts.seq || []; // the order to run the tasks
	this.tasks = {}; // task objects: name, dep (list of names of dependencies), fn (the task to run)
	this.isRunning = false; // is the orchestrator running tasks? .run() to start, .stop() to end
};

Orchestrator.prototype = {
	reset: function () {
		this.stop(null);
		this.tasks = {};
		this.seq = [];
		this.isRunning = false;
		this.doneCallback = undefined;
		return this;
	},
	add: function (name, dep, fn) {
		if (!fn) {
			fn = dep;
			dep = undefined;
		}
		if (!name || !fn) {
			throw new Error('Task requires a name and a function to execute');
		}
		// TODO: validate name is a string, dep is an array of strings, and fn is a function
		this.tasks[name] = {
			fn: fn,
			dep: dep || [],
			name: name
		};
		return this;
	},
	// tasks and optionally a callback
	run: function() {
		var names, lastTask, i, seq = [];
		names = [].slice.call(arguments, 0);
		if (names.length) {
			lastTask = names[names.length-1];
			if (typeof lastTask === 'function') {
				this.doneCallback = lastTask;
				names.pop();
			}
		}
		if (this.isRunning) {
			// if you call run() again while a previous run is still in play
			// prepend the new tasks to the existing task queue
			names = names.concat(this.seq);
		}
		if (names.length < 1) {
			// run all tasks
			for (i in this.tasks) {
				if (this.tasks.hasOwnProperty(i)) {
					names.push(this.tasks[i].name);
				}
			}
		}
		seq = [];
		this.sequence(this.tasks, names, seq, []);
		this.seq = seq;
		if (this.verbose) {
			console.log('[seq: '+this.seq.join(',')+']');
		}
		if (!this.isRunning) {
			this.isRunning = true;
		}
		this._runStep();
		return this;
	},
	stop: function (err, successfulFinish) {
		this.isRunning = false;
		if (this.verbose) {
			if (err) {
				console.log('[orchestration failed]');
			} else if (successfulFinish) {
				console.log('[orchestration succeeded]');
			} else {
				console.log('[orchestration aborted]'); // ASSUME
			}
		}
		if (this.doneCallback) {
			// Avoid calling it multiple times
			var cb = this.doneCallback;
			this.doneCallback = null;
			cb(err);
		}
	},
	sequence: require('./lib/sequence'),
	allDone: function () {
		var i, task, allDone = true; // nothing disputed it yet
		for (i = 0; i < this.seq.length; i++) {
			task = this.tasks[this.seq[i]];
			if (!task.done) {
				allDone = false;
				break;
			}
		}
		return allDone;
	},
	_runStep: function () {
		var i, task;
		if (!this.isRunning) {
			return; // user aborted, ASSUME: stop called previously
		}
		for (i = 0; i < this.seq.length; i++) {
			task = this.tasks[this.seq[i]];
			if (!task.done && !task.running && this._readyToRunTask(task)) {
				this._runTask(task);
			}
			if (!this.isRunning) {
				return; // task failed or user aborted, ASSUME: stop called previously
			}
		}
		if (this.allDone()) {
			this.stop(null, true);
		}
	},
	_readyToRunTask: function (task) {
		var ready = true, // no one disproved it yet
			i, name, t;
		if (task.dep.length) {
			for (i = 0; i < task.dep.length; i++) {
				name = task.dep[i];
				t = this.tasks[name];
				if (!t) {
					// FRAGILE: this should never happen
					this.stop("can't run "+task.name+" because it depends on "+name+" which doesn't exist");
					ready = false;
					break;
				}
				if (!t.done) {
					ready = false;
					break;
				}
			}
		}
		return ready;
	},
	_runTask: function (task) {
		var that = this, cb, p;
		if (this.verbose) {
			console.log('['+task.name+' started]');
		}
		task.running = true;
		cb = function (err) {
			task.running = false;
			task.done = true;
			if (that.verbose) {
				console.log('['+task.name+' calledback]');
			}
			if (err) {
				return that.stop.call(that, err);
			}
			that._runStep.call(that);
		};
		try {
			p = task.fn.call(this, cb);
		} catch (err) {
			this.stop(err || task.name+' threw an exception');
		}
		if (p && p.done) {
			// wait for promise to resolve
			// FRAGILE: ASSUME: Promises/A+, see http://promises-aplus.github.io/promises-spec/
			p.done(function () {
				task.running = false;
				task.done = true;
				if (that.verbose) {
					console.log('['+task.name+' resolved]');
				}
				that._runStep.call(that);
			}, function(err) {
				task.running = false;
				task.done = true;
				if (that.verbose) {
					console.log('['+task.name+' rejected]');
				}
				that.stop.call(that, err || task.name+' promise rejected');
			});
		} else if (!task.fn.length) {
			// no promise, no callback, we're done
			if (this.verbose) {
				console.log('['+task.name+' finished]');
			}
			task.running = false;
			task.done = true;
		//} else {
			// FRAGILE: ASSUME: callback
		}
	}
};

module.exports = Orchestrator;
