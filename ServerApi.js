/**
 * A Node-friendly way to initialise a remote API. cf: RemoteApi.js in the client
 */
var http = require('http') ;
var URL = require('url') ;

var DEBUG = global.DEBUG || (process.env.DEV ? function(){ console.log.apply(this,arguments); }:function(){}) ;

function getOwnPropertyDescriptions(obj) {
	var d = {};
	Object.keys(obj).forEach(function(k){
		d[k] = Object.getOwnPropertyDescriptor(obj,k) ;
	});
	return d ;
} ;

function callRemoteFuncBack(that,path,args) {
	return function(callback,error) {
		if (!callback) callback = that.onSuccess.bind(that) ;
		if (!error) error = that.onError.bind(that) ;

		var uriRequest = URL.parse(path) ;
		uriRequest.method = "POST" ;
		if (that.headers) {
			uriRequest.headers = uriRequest.headers || {} ;
			Object.keys(that.headers).forEach(function(k){
				uriRequest.headers[k] = that.headers[k] ;
			}) ;
		}
			
		var tStart = Date.now() ;
		var x = http.request(uriRequest, function(res){
			res.setEncoding('utf8');
			var body = "" ;
			res.on('data', function (chunk) { body += chunk ; });
			res.once('end',function(){
				if (res.statusCode==200) {
					DEBUG(1,path,args,res.statusCode,(Date.now()-tStart)+"ms") ;
					var data = body ;
					callback(!data?data:JSON.parse(data,that.reviver)) ;
				} else {
					DEBUG(25,path,args,res.statusCode,(Date.now()-tStart)+"ms\n"+body) ;
					if (res.headers['content-type']=="application/json") {
						var exception = JSON.parse(body,that.reviver) ;
						var exc = new Error(body) ;
						Object.defineProperties(exc, getOwnPropertyDescriptions(exception)) ;
						exc.constructor = Error ;
						error(exc) ;
					} else {
						error(new Error(body)) ;
					}
				}
			}) ;
		}).on('error', function(e) {
			error(e) ;
		}) ;

		x.setHeader("Content-Type","application/json") ;
		x.write(JSON.stringify(Array.prototype.slice.call(args),that.serializer)) ;
		x.end() ;
	};
}

function ServerApi(url,onLoad) {
	var that = this ;
	if (!onLoad) onLoad = function(){};

	var u = (typeof url==='string')?URL.parse(url):url ;
	var path = u.pathname.split("/") ;
	if (path[path.length-1]=="")
		path.pop(); // Strip any trailing "/"
	that.version = Number(path[path.length-1].match(/^[0-9.]+$/)) ; 
	if (that.version>0) {
		path.pop() ; // Strip the version number
	} else {
		this.version = "" ;
	}
	u.pathname = path.join("/") ;
	url = URL.format(u) ;
	
	http.get(url+"/"+that.version, function(res) {
		if (res.statusCode != 200) {
			var ex = new Error("HTTP response "+res.statusCode+" "+url.toString()) ;
			ex.errorObject = res ;
			onLoad.call(that,ex) ;
		} else {
			res.setEncoding('utf8');
			var body = "" ;
			res.on('data', function (chunk) { body += chunk ; });
			res.once('end',function(){
				var api = JSON.parse(body) ;
				Object.keys(api).forEach(function(i){
					that[i] = function() { 
						return callRemoteFuncBack(that,url+"/"+i+"/"+that.version,arguments) ; 
					};
				}) ;
				onLoad.call(that,null) ;
			}) ;
		}
	}).on('error', function(e) {
		onLoad.call(that,e) ;
	});
};

ServerApi.prototype.onSuccess = function(result){};
ServerApi.prototype.onError = function(error){};
ServerApi.prototype.headers = null ;
ServerApi.prototype.serializer = null ;
ServerApi.prototype.reviver = null ;

ServerApi.load = function(url) {
	return function($return,$error) {
		new ServerApi(url,function(ex){
			if (ex) $error(ex) ;
			else $return(this) ;
		}) ;
	};
};

module.exports = ServerApi ;