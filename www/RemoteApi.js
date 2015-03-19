window.RemoteApi = (function(){
	function Nothing(){} ;

	function Thenable(resolver) {
		var fn = function(result,error){
			try {
				return resolver.call(this,result,error) ;
			} catch(ex) {
				return error.call(this,ex) ;
			}
		} ;
		fn.then = fn ;
		return fn ;
	};
	
	Object.defineProperty(Function.prototype,"$asyncbind",{
		value:function(self,catcher) {
			var fn = this ;
			fn.isAsync = true ;
			var thenable = function(result,error){
				try {
					return fn.call(self,result,error);
				} catch (ex) {
					return catcher.call(self,ex);
				}
			} ; 
			thenable.then = thenable ;
			return thenable ;
		}
	}) ;

	function hash(o) {
		if (o===undefined) return "undefined" ;
		if (o===null) return "null" ;
		if (typeof o==="object"){
			var h = "";
			Object.keys(o).forEach(function(k) { h += hash(o[k])}) ;
			return hash(h) ;
		} else {
			var h = 0;
			var s = o.toString() ;
	        for (var i=0; i<s.length; i++)
	            h = (((h << 5) - h) + s.charCodeAt(i)) & 0xFFFFFFFF;
	        return h.toString(36) ;
		}
	}
	
	function cacheKey(args,incl) {
		// Key on no args
		if (!incl || !incl.length)
			return "." ;

		// Key on all args
		if (incl=="*") {
			return hash(Array.prototype.slice.call(args)) ;
		}
		
		// Key onspecific args
		var src = [] ;
		for (var i=0; i<incl.length; i++)
			src.push(args[incl[i]]) ;
		return hash(src) ;
	}
	
	function setHeaders(x,headers) {
		if (headers)
			for (var name in headers) 
				if (headers.hasOwnProperty(name) && typeof headers[name]!='undefined')
					x.setRequestHeader(name,headers[name]) ;
	}

	function RemoteApi(url,options,onLoad) {
		function callRemoteFuncBack(that,path,name,args) {
			return new Thenable(function(callback,error) {
				that.apiStart(path,name,args) ;
				if (!callback) callback = that.onSuccess ;
				if (!error) error = that.onError ;
				var x = new XMLHttpRequest() ;
				x.toString = function() {
					return path+"/"+name+"/"+that.version+":"+x.status+" - "+new Date().toString() ;
				};
				x.open("POST", path+"/"+name+"/"+that.version, true);
				x.setRequestHeader("Content-Type","application/json; charset=utf-8") ;
				x.setRequestHeader("documentReferer", document.referrer);
				setHeaders(x,that.headers) ;
				x.onreadystatechange = function() {
					if (x.readyState==4) {
						var contentType = x.getResponseHeader("Content-Type") ;
						if (contentType) contentType = contentType.split(";")[0] ; 
						if (contentType=="application/json" || contentType=="text/plain") {
							var data = x.responseText ;
							try {
								if (contentType=="application/json")
									data = !data?data:JSON.parse(data,that.reviver) ;
							} catch (ex) {
								that.apiEnd(path,name,args,false) ;
								return error(ex) ;
							}
							if (x.status==200) {
								that.apiEnd(path,name,args,true) ;
								return callback(data) ;
							} else {
								var toString = data.toString.bind(data) ;
								data.toString = function() { return x.toString()+"\n"+toString() } ;
								that.apiEnd(path,name,args,false) ;
								return error(data) ;
							}
						} else {
							if (x.status==0) { // No network
								var ex = new Error() ;
								ex.networkError = true ;
								that.apiEnd(path,name,args,false) ;
								return error(ex) ;
							} else {
								var ex = new Error() ;
								ex.toString = function() { return x.toString()+": Bad response\n\n"+x.responseText ; } ;
								that.apiEnd(path,name,args,false) ;
								return error(ex) ;
							}
						}
					}
				}
				x.send(JSON.stringify(Array.prototype.slice.call(args),that.serializer)) ;
				return x.abort.bind ? x.abort.bind(x):function(){ x.abort(); } ;
			}) ;
		}

		var that = this ;

		if (options) {
			Object.keys(options).forEach(function(k){
				that[k] = options[k] ;
			}) ;
		}
		
		if (typeof url!="function") {
			var path = url ;
			path = path.split("/") ;
			if (path[path.length-1]=="")
				path.pop(); // Strip any trailing "/"
			var version = Number(path[path.length-1].match(/^[0-9.]+$/)) ; 
			if (version && !isNaN(version)) {
				path.pop() ; // Strip the version number
				this.version = version ;
			}
			url = path.join("/") ;
		}
		
			
		if (!onLoad)
			onLoad = function(){} ;

		function loadApi(url,api){
			setInterval(function(){
				var now = Date.now() ;
				Object.keys(api).forEach(function(i) {
					if (api[i] && api[i].cache)
						for (var k in api[i].cache)
							if (((Date.now()-api[i].cache[k].t)/1000) >= api[i].ttl.t) 
								delete api[i].cache[k] ;
				}) ;
			},that.cacheSweepInterval || 60000) ;
			
			Object.keys(api).forEach(function(i) {
				if (api[i] && api[i].parameters) {
					if (!that.noLazyCache && api[i].ttl) {
						api[i].cache = {} ;
						that[i] = function() {
							var key = cacheKey(arguments,api[i].ttl.on) ;
							if (api[i].cache[key] && (((Date.now()-api[i].cache[key].t)/1000) < api[i].ttl.t)) {
								return new Thenable(function(ok,error) {
									that.log("Cache hit "+i) ;
									return (ok || that.onSuccess)(api[i].cache[key].data) ;
								}) ;
							} 
							var cb = callRemoteFuncBack(this,url,i,arguments) ;
							return new Thenable(function(ok,err) {
								return cb(function(d){
									that.log("Cache miss "+i) ;
									api[i].cache[key] = {t:Date.now(),data:d} ;
									return ok && ok.apply(this,arguments)
								},function(e){ 
									that.log("Cache err "+i) ;
									delete api[i].cache[key] ;
									return err && err.apply(this,arguments)
								}) ;
							}) ;
						}
						that[i].clearCache = function() {
							api[i].cache = {} ;
						}
					} else {
						that[i] = function() {
							that.log("Call "+i) ;
							return callRemoteFuncBack(this,url,i,arguments) ; 
						}
						that[i].clearCache = Nothing ;
					}
					that[i].parameters = api[i].parameters ;
					that[i].remoteName = url+"/"+i ; 
				} else {
					var staticVal = that.reviver?that.reviver("",api[i]):api[i] ; 
					that[i] = function() {
						return new Thenable(function(ok,error) {
							return (ok || that.onSuccess)(staticVal) ;
						}) ;
					} ;
					that[i].clearCache = Nothing ;
					that[i].remoteName = url+"/"+i ; 
					if (api[i]._isRemoteApi) {
						delete staticVal._isRemoteApi ;
						new RemoteApi(that[i],options,function(){
							that[i] = this ;
						}) ;
					}
				}
			}) ;
			onLoad.call(that,null) ;
		}
		
		if (typeof url === 'function') {
			function loadAsync(api){
				loadApi(url.remoteName,api);
			}
			url()(loadAsync) ;
		} else {
			var x = new XMLHttpRequest() ;
			x.open("GET", url+"/"+that.version, true);
			
			x.setRequestHeader("documentReferer", document.referrer);
			setHeaders(x,that.headers) ;

			x.onreadystatechange = function() {
				if (x.readyState==4) {
					if (x.status==200) {
						var api = JSON.parse(x.responseText) ;
						loadApi(url,api) ;
					} else {
						onLoad.call(that,x) ;
					}
				}
			}
			x.send() ;
		}
		return this;
	}

	RemoteApi.prototype = {
		onSuccess:function(result){},
		onError:function(xhr){},
		apiStart:function(path,name,args,data){},
		apiEnd:function(path,name,args,data){},
		version:"",
		reviver:null,
		serializer:null,
		headers:null,
		log:function() {}
	} ;

	RemoteApi.load = function(url,options) {
		return new Thenable(function($return,$error) {
			new RemoteApi(url,options,function(ex){
				if (ex) $error && $error(ex) ;
				else $return(this) ;
			}) ;
		});
	};

	return RemoteApi ;
})() ;
